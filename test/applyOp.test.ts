import { describe, expect, it } from "vitest";
import { applyOp, defaultBoard } from "../src/shared/applyOp";
import type { Board, Envelope, Op } from "../src/shared/types";

let seq = 0;
const env = (op: Op, ts: number): Envelope => ({ cid: "c", seq: ++seq, ts, op });

function boardWith(...envs: Envelope[]): Board {
  const b = defaultBoard("test234");
  for (const e of envs) applyOp(b, e);
  return b;
}

const story = (id = "s1", ts = 10): Envelope => env({ t: "story.create", id, title: "story", orderKey: "a" }, ts);
const task = (id = "t1", ts = 10, column = "todo", storyId = "s1"): Envelope =>
  env(
    { t: "task.create", id, storyId, column, title: "task", assignee: "", priority: false, note: "", attachments: [], orderKey: "a" },
    ts,
  );

describe("field LWW", () => {
  it("older set loses, newer wins", () => {
    const b = boardWith(story("s1", 10));
    applyOp(b, env({ t: "story.set", id: "s1", set: { title: "old" } }, 5));
    expect(b.stories.s1.title).toBe("story");
    applyOp(b, env({ t: "story.set", id: "s1", set: { title: "new" } }, 20));
    expect(b.stories.s1.title).toBe("new");
  });

  it("different fields merge independently", () => {
    const b = boardWith(story(), task());
    applyOp(b, env({ t: "task.set", id: "t1", set: { title: "T" } }, 30));
    applyOp(b, env({ t: "task.set", id: "t1", set: { assignee: "alex" } }, 20));
    expect(b.tasks.t1.title).toBe("T");
    expect(b.tasks.t1.assignee).toBe("alex");
  });

  it("converges regardless of arrival order", () => {
    const a = env({ t: "story.set", id: "s1", set: { title: "A" } }, 20) as Envelope;
    const c = env({ t: "story.set", id: "s1", set: { title: "C" } }, 30) as Envelope;
    const b1 = boardWith(story("s1", 10), a, c);
    const b2 = boardWith(story("s1", 10), c, a);
    expect(b1.stories.s1.title).toBe("C");
    expect(b2).toEqual(b1);
  });
});

describe("moves", () => {
  it("position is one LWW field", () => {
    const b = boardWith(story(), task());
    applyOp(b, env({ t: "task.move", id: "t1", storyId: "s1", column: "inprog", orderKey: "b" }, 30));
    applyOp(b, env({ t: "task.move", id: "t1", storyId: "s1", column: "verify", orderKey: "c" }, 20));
    expect(b.tasks.t1.column).toBe("inprog");
  });

  it("stamps doneAt on entering done, keeps it inside, clears it on leaving", () => {
    const b = boardWith(story(), task());
    applyOp(b, env({ t: "task.move", id: "t1", storyId: "s1", column: "done", orderKey: "b" }, 50));
    expect(b.tasks.t1.doneAt).toBe(50);
    applyOp(b, env({ t: "task.move", id: "t1", storyId: "s1", column: "done", orderKey: "c" }, 60));
    expect(b.tasks.t1.doneAt).toBe(50);
    applyOp(b, env({ t: "task.move", id: "t1", storyId: "s1", column: "todo", orderKey: "d" }, 70));
    expect(b.tasks.t1.doneAt).toBeNull();
  });
});

describe("orphan guards", () => {
  it("drops a task created in a missing story or column", () => {
    const b = boardWith(story());
    applyOp(b, task("t1", 10, "todo", "ghost"));
    applyOp(b, task("t2", 10, "ghostcol"));
    expect(Object.keys(b.tasks)).toEqual([]);
  });

  it("keeps a task where it was when the move target vanished", () => {
    const b = boardWith(story(), task());
    applyOp(b, env({ t: "task.move", id: "t1", storyId: "s1", column: "ghostcol", orderKey: "b" }, 30));
    expect(b.tasks.t1.column).toBe("todo");
  });

  it("story delete cascades to its tasks", () => {
    const b = boardWith(story(), task());
    applyOp(b, env({ t: "story.del", id: "s1" }, 30));
    expect(b.tasks).toEqual({});
  });
});

describe("columns", () => {
  it("protects todo/inprog and refuses deleting a non-empty column", () => {
    const b = boardWith(story(), task());
    applyOp(b, env({ t: "col.del", id: "todo" }, 30));
    applyOp(b, env({ t: "col.del", id: "inprog" }, 30));
    expect(b.columns.map((c) => c.id)).toContain("todo");
    expect(b.columns.map((c) => c.id)).toContain("inprog");
    applyOp(b, env({ t: "task.move", id: "t1", storyId: "s1", column: "verify", orderKey: "b" }, 40));
    applyOp(b, env({ t: "col.del", id: "verify" }, 50));
    expect(b.columns.map((c) => c.id)).toContain("verify");
  });

  it("refuses duplicate and reserved column ids, clamps index", () => {
    const b = boardWith();
    applyOp(b, env({ t: "col.add", id: "done", name: "x", index: 0 }, 10));
    applyOp(b, env({ t: "col.add", id: "todo", name: "x", index: 0 }, 10));
    expect(b.columns.length).toBe(3);
    applyOp(b, env({ t: "col.add", id: "c9", name: "x", index: 99 }, 10));
    expect(b.columns.at(-1)!.id).toBe("c9");
  });
});

describe("board fields", () => {
  it("name and key are LWW", () => {
    const b = boardWith();
    applyOp(b, env({ t: "board.setName", name: "later" }, 30));
    applyOp(b, env({ t: "board.setName", name: "earlier" }, 20));
    expect(b.name).toBe("later");
    applyOp(b, env({ t: "board.setKey", key: "k1" }, 30));
    applyOp(b, env({ t: "board.setKey", key: "" }, 40));
    expect(b.uploadcareKey).toBeUndefined();
  });

  it("replaying the same create is a no-op", () => {
    const e = story("s1", 10);
    const b = boardWith(e);
    applyOp(b, env({ t: "story.set", id: "s1", set: { title: "edited" } }, 20));
    applyOp(b, e);
    expect(b.stories.s1.title).toBe("edited");
  });
});
