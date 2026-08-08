import { NAME_RE } from "../shared/id";
import { ATTACHMENTS_MAX, NOTE_MAX } from "../shared/types";
import type { Attachment, Envelope } from "../shared/types";

const TITLE_MAX = 2000;
const ASSIGNEE_MAX = 120;
const COLNAME_MAX = 60;
const KEY_MAX = 100;
const ORDER_MAX = 64;
const ID_MAX = 64;
const URL_MAX = 600;
const FILENAME_MAX = 200;

// Every op is rebuilt as a well-formed client would have sent it: required
// fields must be the right type (throw = drop the op), free text is clamped,
// `set` is whitelisted per kind. Nothing unvalidated reaches applyOp or
// storage — a hand-crafted op must not be able to wedge rendering on every
// client or bloat the board past its own caps.
export function sanitizeOp(env: Envelope): void {
  const op = env.op as Record<string, unknown> & { t?: unknown };
  switch (op.t) {
    case "story.create":
      env.op = { t: "story.create", id: id(op.id), title: text(op.title, TITLE_MAX), orderKey: order(op.orderKey) };
      return;
    case "story.set":
      env.op = { t: "story.set", id: id(op.id), set: cleanSet(op.set, "story") };
      return;
    case "story.move":
      env.op = { t: "story.move", id: id(op.id), orderKey: order(op.orderKey) };
      return;
    case "story.del":
      env.op = { t: "story.del", id: id(op.id) };
      return;
    case "task.create":
      env.op = {
        t: "task.create",
        id: id(op.id),
        storyId: id(op.storyId),
        column: id(op.column),
        title: text(op.title, TITLE_MAX),
        assignee: text(op.assignee, ASSIGNEE_MAX),
        priority: op.priority === true,
        note: text(op.note, NOTE_MAX),
        attachments: cleanAttachments(op.attachments),
        orderKey: order(op.orderKey),
      };
      return;
    case "task.set":
      env.op = { t: "task.set", id: id(op.id), set: cleanSet(op.set, "task") };
      return;
    case "task.move":
      env.op = {
        t: "task.move",
        id: id(op.id),
        storyId: id(op.storyId),
        column: id(op.column),
        orderKey: order(op.orderKey),
      };
      return;
    case "task.del":
      env.op = { t: "task.del", id: id(op.id) };
      return;
    case "col.add":
      env.op = { t: "col.add", id: id(op.id), name: text(op.name, COLNAME_MAX), index: index(op.index) };
      return;
    case "col.set":
      env.op = { t: "col.set", id: id(op.id), name: text(op.name, COLNAME_MAX) };
      return;
    case "col.move":
      env.op = { t: "col.move", id: id(op.id), index: index(op.index) };
      return;
    case "col.del":
      env.op = { t: "col.del", id: id(op.id) };
      return;
    case "board.setName":
      if (typeof op.name !== "string" || !NAME_RE.test(op.name)) throw new Error("bad name"); // names become URLs — reject, don't clamp
      env.op = { t: "board.setName", name: op.name };
      return;
    case "board.setKey":
      env.op = { t: "board.setKey", key: text(op.key, KEY_MAX).trim() };
      return;
    case "board.del":
      env.op = { t: "board.del" };
      return;
    default:
      throw new Error("unknown op"); // don't burn a version broadcasting junk
  }
}

function id(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > ID_MAX) throw new Error("bad id");
  return v;
}

function order(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > ORDER_MAX) throw new Error("bad orderKey");
  return v;
}

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function index(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}

function cleanAttachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return [];
  const out: Attachment[] = [];
  for (const x of v.slice(0, ATTACHMENTS_MAX) as Record<string, unknown>[]) {
    const url = x?.url;
    if (typeof url !== "string" || !/^https:\/\//.test(url) || url.length > URL_MAX) continue; // urls land in hrefs
    out.push({ url, name: text(x.name, FILENAME_MAX), isImage: x.isImage === true });
  }
  return out;
}

type SetFields = Partial<{ title: string; note: string; assignee: string; priority: boolean; attachments: Attachment[] }>;

// rebuilt from scratch — arbitrary keys (id, storyId, ts, orderKey, __proto__)
// must never reach setFields, which assigns whatever keys it's given
function cleanSet(v: unknown, kind: "story" | "task"): SetFields {
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: SetFields = {};
  if (typeof src.title === "string") out.title = src.title.slice(0, TITLE_MAX);
  if (typeof src.note === "string") out.note = src.note.slice(0, NOTE_MAX);
  if ("attachments" in src) out.attachments = cleanAttachments(src.attachments);
  if (kind === "task") {
    if (typeof src.assignee === "string") out.assignee = src.assignee.slice(0, ASSIGNEE_MAX);
    if (typeof src.priority === "boolean") out.priority = src.priority;
  }
  return out;
}
