export type Column = { id: string; name: string };

export type Attachment = { url: string; name: string; isImage: boolean };

// per-field last-write timestamps for LWW merge; "pos" covers storyId+column+orderKey as one field
export type FieldTs = Record<string, number>;

export type Story = {
  id: string;
  title: string;
  note: string;
  attachments: Attachment[];
  orderKey: string;
  ts: FieldTs;
};

export type Task = {
  id: string;
  storyId: string;
  column: string; // column id; "done" is implicit and always last
  title: string;
  assignee: string;
  priority: boolean;
  note: string;
  attachments: Attachment[];
  orderKey: string;
  doneAt: number | null;
  ts: FieldTs;
};

export type Board = {
  id: string; // permanent identity — the trailing token of the board URL
  name: string; // URL flavor, renameable; "" = show whatever flavor the URL carries
  columns: Column[]; // ordered flow columns; "todo" and "inprog" permanent, "done" not listed
  stories: Record<string, Story>;
  tasks: Record<string, Task>;
  createdAt: number;
  deletedAt: number | null;
  ts: FieldTs; // LWW timestamps for board-level fields (name, key)
  // Uploadcare public key, per board — the team using the board brings its own
  // account. Public by design (it ships in client code), so it rides in board state.
  uploadcareKey?: string;
};

export type Op =
  | { t: "story.create"; id: string; title: string; orderKey: string }
  | { t: "story.set"; id: string; set: Partial<Pick<Story, "title" | "note" | "attachments">> }
  | { t: "story.move"; id: string; orderKey: string }
  | { t: "story.del"; id: string }
  | {
      t: "task.create";
      id: string;
      storyId: string;
      column: string;
      title: string;
      assignee: string;
      priority: boolean;
      note: string;
      attachments: Attachment[];
      orderKey: string;
    }
  | { t: "task.set"; id: string; set: Partial<Pick<Task, "title" | "note" | "assignee" | "priority" | "attachments">> }
  | { t: "task.move"; id: string; storyId: string; column: string; orderKey: string }
  | { t: "task.del"; id: string }
  | { t: "col.add"; id: string; name: string; index: number }
  | { t: "col.set"; id: string; name: string }
  | { t: "col.move"; id: string; index: number }
  | { t: "col.del"; id: string }
  | { t: "board.setName"; name: string }
  | { t: "board.setKey"; key: string }
  | { t: "board.del" };

export type Envelope = { cid: string; seq: number; ts: number; op: Op };

export type PresenceUser = { cid: string; name: string; editing: string | null };

export type ClientMsg =
  | { t: "hello"; cid: string; token?: string; v: number; pending: Envelope[] }
  | { t: "ops"; ops: Envelope[] }
  | { t: "setPassword"; password: string }
  | { t: "removePassword" }
  | { t: "presence"; name: string }
  | { t: "editing"; id: string | null };

export type ServerMsg =
  // yourSeq: the highest seq the board has seen from this cid — lets a client
  // whose local seq counter was lost (storage eviction) fast-forward instead of
  // minting stale seqs the server would silently drop
  | { t: "snapshot"; board: Board; version: number; protected: boolean; yourSeq: number }
  | { t: "ops"; ops: Envelope[]; version: number }
  | { t: "deleted" }
  | { t: "authRequired" }
  | { t: "token"; token: string | null }
  | { t: "presence"; users: PresenceUser[] };

export const NOTE_MAX = 4096;
export const ATTACHMENTS_MAX = 10;
