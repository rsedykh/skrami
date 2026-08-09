import { DurableObject } from "cloudflare:workers";
import { applyOp, defaultBoard } from "../shared/applyOp";
import type { Board, ClientMsg, Envelope, PresenceUser, ServerMsg } from "../shared/types";
import { sanitizeOp } from "./sanitize";

const DAY = 24 * 60 * 60 * 1000;
const PURGE_AFTER = 30 * DAY;
const KEEP_SNAPSHOTS = 30;
const FREE_ATTEMPTS = 3;
const PBKDF2_ITERATIONS = 10_000;

type Attachment = { id: string; helloed: boolean; cid?: string; name?: string; editing?: string | null };
type Auth = { hash: string; salt: string; token: string };

export class BoardDO extends DurableObject<Env> {
  // undefined = not loaded yet; null = nothing stored (board exists only virtually)
  private board: Board | null | undefined;
  private version = 0;
  private seqs = new Map<string, number>();
  private auth: Auth | null = null;
  private fail = { count: 0, until: 0 };
  private stored = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/ws")) {
      if (req.headers.get("Upgrade") !== "websocket")
        return new Response("Expected WebSocket", { status: 426 });
      const pair = new WebSocketPair();
      const id = path.split("/")[2];
      pair[1].serializeAttachment({ id, helloed: false } satisfies Attachment);
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path.endsWith("/auth") && req.method === "POST") return this.handleAuth(req);
    return new Response("Not found", { status: 404 });
  }

  // ---------- password ----------

  private async handleAuth(req: Request): Promise<Response> {
    // drain the body before any early return — responding with the stream
    // unread makes the runtime throw "can't read from request stream"
    let password = "";
    try {
      password = String(((await req.json()) as { password?: string }).password ?? "");
    } catch {}
    this.load();
    if (!this.auth) return json({ error: "no password" }, 400);
    const now = Date.now();
    if (this.fail.count > FREE_ATTEMPTS && now < this.fail.until)
      return json({ retryAfter: Math.ceil((this.fail.until - now) / 1000) }, 429);
    const hash = await hashPassword(password, this.auth.salt);
    if (hash === this.auth.hash) {
      this.fail = { count: 0, until: 0 };
      this.persistFail();
      return json({ token: this.auth.token });
    }
    this.fail.count++;
    // single-threaded actor: this counter cannot be raced or parallelized around
    if (this.fail.count > FREE_ATTEMPTS)
      this.fail.until = now + Math.min(2 ** (this.fail.count - FREE_ATTEMPTS), 600) * 1000;
    this.persistFail();
    return json({ error: "wrong" }, 403);
  }

  private async setPassword(ws: WebSocket, password: string): Promise<void> {
    if (!password || password.length > 200) return;
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = btoa(String.fromCharCode(...saltBytes));
    this.auth = { salt, hash: await hashPassword(password, salt), token: crypto.randomUUID() };
    this.fail = { count: 0, until: 0 };
    this.ensureStorage((ws.deserializeAttachment() as Attachment).id);
    this.persistAuth();
    this.persistFail();
    // only the setter gets the fresh token — every other device re-auths at its next connect
    this.send(ws, { t: "token", token: this.auth.token });
  }

  private removePassword(ws: WebSocket): void {
    if (!this.auth) return;
    this.auth = null;
    this.persistAuth();
    this.send(ws, { t: "token", token: null });
  }

  // ---------- websocket ----------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    this.load();
    const att = ws.deserializeAttachment() as Attachment;

    if (msg.t === "hello") {
      const board = this.board ?? defaultBoard(att.id);
      if (board.deletedAt) {
        this.send(ws, { t: "deleted" });
        ws.close(4001, "deleted");
        return;
      }
      // the gate comes before pending ops — an unauthenticated client writes nothing
      if (this.auth && msg.token !== this.auth.token) {
        this.send(ws, { t: "authRequired" });
        ws.close(4003, "auth required");
        return;
      }
      const applied = this.applyEnvelopes(board, msg.pending);
      ws.serializeAttachment({ ...att, helloed: true, cid: msg.cid } satisfies Attachment);
      if (applied.length) this.broadcast({ t: "ops", ops: applied, version: this.version }, ws);
      this.send(ws, {
        t: "snapshot",
        board,
        version: this.version,
        protected: !!this.auth,
        yourSeq: this.seqs.get(msg.cid) ?? 0,
      });
      this.afterApply(board);
      return;
    }

    if (!att.helloed) return;

    switch (msg.t) {
      case "ops": {
        const board = this.board ?? defaultBoard(att.id);
        if (board.deletedAt) {
          this.send(ws, { t: "deleted" });
          ws.close(4001, "deleted");
          return;
        }
        const applied = this.applyEnvelopes(board, msg.ops);
        // echo to the sender too — the echo is the ack that drains the client queue
        if (applied.length) this.broadcast({ t: "ops", ops: applied, version: this.version });
        this.afterApply(board);
        return;
      }
      case "setPassword":
        return this.setPassword(ws, String(msg.password ?? ""));
      case "removePassword":
        return this.removePassword(ws);
      case "presence":
        ws.serializeAttachment({ ...att, name: String(msg.name ?? "").slice(0, 60) } satisfies Attachment);
        this.broadcastPresence();
        return;
      case "editing":
        ws.serializeAttachment({ ...att, editing: msg.id ? String(msg.id) : null } satisfies Attachment);
        this.broadcastPresence();
        return;
    }
  }

  async webSocketClose(): Promise<void> {
    this.broadcastPresence();
  }

  async webSocketError(): Promise<void> {
    this.broadcastPresence();
  }

  // ---------- ops ----------

  private applyEnvelopes(board: Board, envs: Envelope[]): Envelope[] {
    const applied: Envelope[] = [];
    if (!Array.isArray(envs)) return applied;
    const now = Date.now();
    for (const env of envs.slice(0, 500)) {
      if (typeof env.cid !== "string" || !env.cid || env.cid.length > 64) continue;
      const last = this.seqs.get(env.cid) ?? 0;
      if (typeof env.seq !== "number" || env.seq <= last) continue;
      env.ts = Math.min(Number(env.ts) || now, now + 2000);
      try {
        sanitizeOp(env);
        applyOp(board, env);
      } catch {
        continue;
      }
      this.seqs.set(env.cid, env.seq);
      this.version++;
      applied.push(env);
    }
    if (applied.length) {
      if (this.board === null) board.createdAt = board.createdAt || now;
      this.board = board;
      this.ensureStorage(board.id);
      this.persistBoard();
    }
    return applied;
  }

  private afterApply(board: Board): void {
    if (!board.deletedAt) return;
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: "deleted" });
      ws.close(4001, "deleted");
    }
  }

  // ---------- storage ----------

  private load(): void {
    if (this.board !== undefined) return;
    const sql = this.ctx.storage.sql;
    const has = sql.exec("SELECT name FROM sqlite_master WHERE name='kv'").toArray().length > 0;
    if (!has) {
      this.board = null;
      return;
    }
    const rows = new Map(
      sql.exec("SELECT key, value FROM kv").toArray().map((r) => [r.key as string, r.value as string]),
    );
    this.board = JSON.parse(rows.get("board") ?? "null");
    this.version = Number(rows.get("version") ?? 0);
    this.seqs = new Map(Object.entries(JSON.parse(rows.get("seqs") ?? "{}")));
    this.auth = JSON.parse(rows.get("auth") ?? "null");
    this.fail = JSON.parse(rows.get("authFail") ?? '{"count":0,"until":0}');
    this.stored = true;
  }

  // A board hits storage only once it has an op or a password — empty boards persist nothing.
  private ensureStorage(id: string): void {
    if (this.stored) return;
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)");
    sql.exec("CREATE TABLE IF NOT EXISTS snapshots (day TEXT PRIMARY KEY, data TEXT)");
    this.stored = true;
    void this.ctx.storage.setAlarm(Date.now() + DAY);
    // operator's creation log — DO namespaces can't be enumerated by name, this KV list is the only registry
    void this.env.REGISTRY.put(id, new Date().toISOString()).catch(() => {});
  }

  private persistBoard(): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO kv (key, value) VALUES ('board', ?), ('version', ?), ('seqs', ?)",
      JSON.stringify(this.board),
      String(this.version),
      JSON.stringify(Object.fromEntries(this.seqs)),
    );
  }

  private persistAuth(): void {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO kv (key, value) VALUES ('auth', ?)", JSON.stringify(this.auth));
  }

  private persistFail(): void {
    if (!this.stored) return; // backoff state on a never-stored board is fine in memory only
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO kv (key, value) VALUES ('authFail', ?)",
      JSON.stringify(this.fail),
    );
  }

  async alarm(): Promise<void> {
    this.load();
    if (!this.stored) return;
    if (this.board?.deletedAt && Date.now() - this.board.deletedAt > PURGE_AFTER) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.board = null;
      this.version = 0;
      this.seqs.clear();
      this.auth = null;
      this.fail = { count: 0, until: 0 };
      this.stored = false;
      return;
    }
    if (this.board) {
      const sql = this.ctx.storage.sql;
      sql.exec(
        "INSERT OR REPLACE INTO snapshots (day, data) VALUES (?, ?)",
        new Date().toISOString().slice(0, 10),
        JSON.stringify({ board: this.board, version: this.version }),
      );
      sql.exec(
        "DELETE FROM snapshots WHERE day NOT IN (SELECT day FROM snapshots ORDER BY day DESC LIMIT ?)",
        KEEP_SNAPSHOTS,
      );
    }
    // reschedule even with no board yet — a board stored by setPassword alone
    // must keep its chain alive, or ops arriving later never get snapshots
    // (ensureStorage arms the alarm only once) and a soft delete never purges
    void this.ctx.storage.setAlarm(Date.now() + DAY);
  }

  // ---------- room ----------

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private broadcast(msg: ServerMsg, except?: WebSocket): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if (!(ws.deserializeAttachment() as Attachment).helloed) continue;
      try {
        ws.send(raw);
      } catch {}
    }
  }

  private broadcastPresence(): void {
    const users: PresenceUser[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      if (att.helloed) users.push({ cid: att.cid ?? "", name: att.name ?? "", editing: att.editing ?? null });
    }
    this.broadcast({ t: "presence", users });
  }
}

async function hashPassword(password: string, saltB64: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
