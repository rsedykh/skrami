import type { Board, ClientMsg, Envelope, Op, PresenceUser, ServerMsg } from "../shared/types";
import { cachePut, nextSeq, queueDel, queueList, queuePut, type QueueRow } from "./db";
import { clientId } from "./prefs";

export type Status = { state: "synced" | "syncing" | "offline"; queued: number };

export type SyncHandlers = {
  onApply(env: Envelope): void; // apply one op to the store + DOM (local and remote alike)
  onSnapshot(board: Board, version: number, isProtected: boolean): void;
  onDeleted(): void;
  onStatus(s: Status): void;
  onAuthRequired(): void;
  onToken(token: string | null): void;
  onMoved(slug: string): void;
  onRenameError(): void;
  onPresence(users: PresenceUser[]): void;
};

const HEARTBEAT = 10_000;
const PONG_TIMEOUT = 5_000;

export class Sync {
  private ws: WebSocket | undefined;
  private queue: QueueRow[] = [];
  private applied = new Set<string>(); // `${cid}:${seq}` this tab already ran through onApply
  private helloKeys: string[] = [];
  private version = 0;
  private backoff = 500;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private board: Board | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private token: string | null = null;
  private gated = false; // authRequired received — stop reconnecting until a token arrives
  readonly cid = clientId();

  constructor(
    private slug: string,
    private handlers: SyncHandlers,
  ) {}

  // replays any queued ops from previous sessions onto the cached board, then connects
  async start(board: Board, version: number, token: string | null): Promise<void> {
    this.board = board;
    this.version = version;
    this.token = token;
    this.queue = await queueList(this.slug);
    for (const row of this.queue) {
      this.applied.add(`${row.cid}:${row.seq}`);
      this.handlers.onApply(row.env);
    }
    addEventListener("online", () => this.poke());
    addEventListener("focus", () => this.poke());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.poke();
    });
    setInterval(() => this.heartbeat(), HEARTBEAT);
    this.connect();
  }

  async submit(op: Op): Promise<void> {
    await this.submitBatch([op]);
  }

  // one message per batch — the DO applies it in one turn, so groups land together
  async submitBatch(ops: Op[]): Promise<void> {
    const envs: Envelope[] = [];
    for (const op of ops) {
      const seq = await nextSeq(this.slug);
      const env: Envelope = { cid: this.cid, seq, ts: Date.now(), op };
      const row: QueueRow = { slug: this.slug, cid: this.cid, seq, env };
      this.applied.add(`${this.cid}:${seq}`);
      this.queue.push(row);
      this.handlers.onApply(env);
      await queuePut(row);
      envs.push(env);
    }
    this.saveSoon();
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ t: "ops", ops: envs });
    this.pushStatus();
  }

  setToken(token: string | null): void {
    this.token = token;
    if (this.gated) {
      this.gated = false;
      this.backoff = 500;
      this.connect();
    }
  }

  live(msg: ClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.send(msg);
    return true;
  }

  private connect(): void {
    if (this.gated) return;
    clearTimeout(this.reconnectTimer);
    this.pushStatus("syncing");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/b/${this.slug}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.helloKeys = this.queue.map((r) => `${r.cid}:${r.seq}`);
      this.send({
        t: "hello",
        slug: this.slug,
        cid: this.cid,
        token: this.token ?? undefined,
        v: this.version,
        pending: this.queue.map((r) => r.env),
      });
    };
    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onclose = () => this.onDown(ws);
    ws.onerror = () => this.onDown(ws);
  }

  private onMessage(raw: unknown): void {
    if (raw === "pong") {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
      return;
    }
    if (typeof raw !== "string") return;
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.t) {
      case "snapshot": {
        // everything sent in the hello is baked into this snapshot — drop it from the queue
        const helloed = new Set(this.helloKeys);
        this.helloKeys = [];
        for (const row of this.queue.filter((r) => helloed.has(`${r.cid}:${r.seq}`)))
          void queueDel(row.slug, row.cid, row.seq);
        this.queue = this.queue.filter((r) => !helloed.has(`${r.cid}:${r.seq}`));
        this.board = msg.board;
        this.version = msg.version;
        this.backoff = 500;
        this.handlers.onSnapshot(msg.board, msg.version, msg.protected);
        for (const row of this.queue) this.handlers.onApply(row.env); // ops enqueued mid-connect
        if (this.queue.length) this.send({ t: "ops", ops: this.queue.map((r) => r.env) });
        this.saveSoon();
        this.pushStatus();
        return;
      }
      case "ops": {
        for (const env of msg.ops) {
          const key = `${env.cid}:${env.seq}`;
          const mine = this.queue.find((r) => `${r.cid}:${r.seq}` === key);
          if (mine) {
            void queueDel(mine.slug, mine.cid, mine.seq);
            this.queue = this.queue.filter((r) => r !== mine);
          }
          if (!this.applied.has(key)) {
            this.applied.add(key);
            this.handlers.onApply(env);
          }
        }
        const expected = this.version + msg.ops.length;
        this.version = msg.version;
        if (msg.version !== expected && this.ws?.readyState === WebSocket.OPEN) {
          // missed a broadcast — the snapshot path heals everything
          this.helloKeys = this.queue.map((r) => `${r.cid}:${r.seq}`);
          this.send({
            t: "hello",
            slug: this.slug,
            cid: this.cid,
            token: this.token ?? undefined,
            v: this.version,
            pending: this.queue.map((r) => r.env),
          });
        }
        this.saveSoon();
        this.pushStatus();
        return;
      }
      case "deleted":
        return this.handlers.onDeleted();
      case "authRequired":
        this.gated = true;
        clearTimeout(this.reconnectTimer);
        return this.handlers.onAuthRequired();
      case "token":
        this.token = msg.token;
        return this.handlers.onToken(msg.token);
      case "moved":
        this.gated = true; // stop reconnecting; the page is about to navigate
        clearTimeout(this.reconnectTimer);
        return this.handlers.onMoved(msg.slug);
      case "renameError":
        return this.handlers.onRenameError();
      case "presence":
        return this.handlers.onPresence(msg.users);
    }
  }

  private onDown(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.ws = undefined;
    clearTimeout(this.pongTimer);
    this.pongTimer = undefined;
    if (this.gated) return;
    this.pushStatus();
    this.backoff = Math.min(this.backoff * 2, 30_000);
    const delay = this.backoff * (0.5 + Math.random());
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  // wake-from-sleep: don't wait for the heartbeat to notice a dead socket
  private poke(): void {
    if (this.gated) return;
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) {
      this.backoff = 500;
      this.connect();
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) this.heartbeat();
  }

  private heartbeat(): void {
    if (this.ws?.readyState !== WebSocket.OPEN || this.pongTimer) return;
    this.ws.send("ping");
    this.pongTimer = setTimeout(() => this.ws?.close(), PONG_TIMEOUT);
  }

  private send(msg: ClientMsg): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.board) void cachePut(this.slug, { board: this.board, version: this.version });
    }, 250);
  }

  private pushStatus(force?: Status["state"]): void {
    const open = this.ws?.readyState === WebSocket.OPEN;
    const state = force ?? (!open ? "offline" : this.queue.length ? "syncing" : "synced");
    this.handlers.onStatus({ state, queued: this.queue.length });
  }
}
