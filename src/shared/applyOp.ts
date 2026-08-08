import type { Board, Envelope, Story, Task } from "./types";

export function defaultBoard(slug: string): Board {
  return {
    slug,
    columns: [
      { id: "todo", name: "To Do" },
      { id: "inprog", name: "In Progress" },
      { id: "verify", name: "Verify" },
    ],
    stories: {},
    tasks: {},
    createdAt: 0,
    deletedAt: null,
  };
}

// The single write path: local edits, remote broadcasts, and the DO all walk this.
// Ops set absolute values, so replays and duplicates converge; per-field ts gives LWW.
export function applyOp(b: Board, env: Envelope): void {
  const { op, ts } = env;
  switch (op.t) {
    case "story.create": {
      if (b.stories[op.id]) return;
      b.stories[op.id] = {
        id: op.id,
        title: op.title,
        note: "",
        attachments: [],
        orderKey: op.orderKey,
        ts: { title: ts, pos: ts },
      };
      return;
    }
    case "story.set":
      return setFields(b.stories[op.id], op.set, ts);
    case "story.move": {
      const s = b.stories[op.id];
      if (!s || ts < (s.ts.pos ?? 0)) return;
      s.orderKey = op.orderKey;
      s.ts.pos = ts;
      return;
    }
    case "story.del": {
      if (!b.stories[op.id]) return;
      delete b.stories[op.id];
      for (const t of Object.values(b.tasks)) if (t.storyId === op.id) delete b.tasks[t.id];
      return;
    }
    case "task.create": {
      if (b.tasks[op.id]) return;
      b.tasks[op.id] = {
        id: op.id,
        storyId: op.storyId,
        column: op.column,
        title: op.title,
        assignee: op.assignee,
        priority: op.priority,
        note: op.note,
        attachments: op.attachments,
        orderKey: op.orderKey,
        doneAt: op.column === "done" ? ts : null,
        ts: { title: ts, assignee: ts, priority: ts, note: ts, attachments: ts, pos: ts },
      };
      return;
    }
    case "task.set":
      return setFields(b.tasks[op.id], op.set, ts);
    case "task.move": {
      const t = b.tasks[op.id];
      if (!t || ts < (t.ts.pos ?? 0)) return;
      t.doneAt = op.column === "done" ? (t.column === "done" ? t.doneAt : ts) : null;
      t.storyId = op.storyId;
      t.column = op.column;
      t.orderKey = op.orderKey;
      t.ts.pos = ts;
      return;
    }
    case "task.del":
      delete b.tasks[op.id];
      return;
    case "col.add": {
      if (op.id === "done" || b.columns.some((c) => c.id === op.id)) return;
      const i = Math.max(0, Math.min(op.index, b.columns.length));
      b.columns.splice(i, 0, { id: op.id, name: op.name });
      return;
    }
    case "col.set": {
      const c = b.columns.find((c) => c.id === op.id);
      if (c) c.name = op.name;
      return;
    }
    case "col.move": {
      const from = b.columns.findIndex((c) => c.id === op.id);
      if (from < 0) return;
      const [c] = b.columns.splice(from, 1);
      b.columns.splice(Math.max(0, Math.min(op.index, b.columns.length)), 0, c);
      return;
    }
    case "col.del": {
      if (op.id === "todo" || op.id === "inprog") return;
      if (Object.values(b.tasks).some((t) => t.column === op.id)) return;
      b.columns = b.columns.filter((c) => c.id !== op.id);
      return;
    }
    case "board.setKey":
      b.uploadcareKey = op.key || undefined;
      return;
    case "board.del":
      b.deletedAt = ts;
      return;
  }
}

function setFields(obj: Story | Task | undefined, set: Record<string, unknown>, ts: number): void {
  if (!obj) return;
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined || ts < (obj.ts[k] ?? 0)) continue;
    (obj as unknown as Record<string, unknown>)[k] = v;
    obj.ts[k] = ts;
  }
}
