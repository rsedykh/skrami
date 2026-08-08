import { describe, expect, it } from "vitest";
import { sanitizeOp } from "../src/server/sanitize";
import type { Envelope } from "../src/shared/types";

const env = (op: unknown): Envelope => ({ cid: "c", seq: 1, ts: 1, op: op as Envelope["op"] });

describe("sanitizeOp", () => {
  it("whitelists set — foreign keys and wrong types never reach state", () => {
    const e = env({
      t: "task.set",
      id: "t1",
      set: JSON.parse('{"__proto__": {"x": 1}, "id": "hijack", "orderKey": "zzz", "title": 123, "priority": "yes", "note": "ok"}'),
    });
    sanitizeOp(e);
    expect(e.op).toEqual({ t: "task.set", id: "t1", set: { note: "ok" } });
  });

  it("keeps only well-formed https attachments", () => {
    const e = env({
      t: "task.set",
      id: "t1",
      set: {
        attachments: [
          { url: "javascript:alert(1)", name: "evil", isImage: false },
          { url: "https://ucarecdn.com/u/", name: 5, isImage: "y" },
          "junk",
        ],
      },
    });
    sanitizeOp(e);
    expect((e.op as { set: { attachments: unknown } }).set.attachments).toEqual([
      { url: "https://ucarecdn.com/u/", name: "", isImage: false },
    ]);
  });

  it("clamps free text, defaults wrong-typed optionals", () => {
    const e = env({
      t: "task.create",
      id: "t1",
      storyId: "s1",
      column: "todo",
      title: "x".repeat(5000),
      assignee: null,
      priority: "high",
      note: 42,
      attachments: null,
      orderKey: "a",
    });
    sanitizeOp(e);
    const op = e.op as { title: string; assignee: string; priority: boolean; note: string; attachments: unknown[] };
    expect(op.title.length).toBe(2000);
    expect(op.assignee).toBe("");
    expect(op.priority).toBe(false);
    expect(op.note).toBe("");
    expect(op.attachments).toEqual([]);
  });

  it("rejects ops with malformed required fields", () => {
    expect(() => sanitizeOp(env({ t: "story.create", id: "s1", title: "x" }))).toThrow(); // no orderKey
    expect(() => sanitizeOp(env({ t: "task.del", id: 7 }))).toThrow();
    expect(() => sanitizeOp(env({ t: "story.move", id: "s1", orderKey: "x".repeat(65) }))).toThrow();
    expect(() => sanitizeOp(env({ t: "nonsense" }))).toThrow();
  });

  it("rejects names that would not survive as URLs", () => {
    expect(() => sanitizeOp(env({ t: "board.setName", name: "Bad Name" }))).toThrow();
    expect(() => sanitizeOp(env({ t: "board.setName", name: "-edge" }))).toThrow();
    expect(() => sanitizeOp(env({ t: "board.setName", name: 42 }))).toThrow();
    const ok = env({ t: "board.setName", name: "sprint-42" });
    sanitizeOp(ok);
    expect(ok.op).toEqual({ t: "board.setName", name: "sprint-42" });
  });

  it("coerces column indexes to integers", () => {
    const e = env({ t: "col.move", id: "c1", index: 3.7 });
    sanitizeOp(e);
    expect((e.op as { index: number }).index).toBe(3);
    const bad = env({ t: "col.move", id: "c1", index: "9" });
    sanitizeOp(bad);
    expect((bad.op as { index: number }).index).toBe(0);
  });
});
