import { openDB, type IDBPDatabase } from "idb";
import type { Board, Envelope } from "../shared/types";

export type CachedBoard = { board: Board; version: number };
export type QueueRow = { board: string; cid: string; seq: number; env: Envelope };

let dbp: Promise<IDBPDatabase> | undefined;

function db(): Promise<IDBPDatabase> {
  dbp ??= openDB("skrami", 2, {
    upgrade(d, oldVersion) {
      if (oldVersion) for (const s of [...d.objectStoreNames]) d.deleteObjectStore(s); // pre-id dev data, no users yet
      d.createObjectStore("boards");
      d.createObjectStore("queue", { keyPath: ["board", "cid", "seq"] });
      d.createObjectStore("meta");
    },
  });
  return dbp;
}

export async function cacheGet(id: string): Promise<CachedBoard | undefined> {
  return (await db()).get("boards", id);
}

export async function cachePut(id: string, value: CachedBoard): Promise<void> {
  await (await db()).put("boards", value, id);
}

export async function cacheDel(id: string): Promise<void> {
  await (await db()).delete("boards", id);
}

export async function queueList(id: string): Promise<QueueRow[]> {
  const rows: QueueRow[] = await (await db()).getAll(
    "queue",
    IDBKeyRange.bound([id, "", 0], [id, "￿", Infinity]),
  );
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function queuePut(row: QueueRow): Promise<void> {
  await (await db()).put("queue", row);
}

export async function queueDel(id: string, cid: string, seq: number): Promise<void> {
  await (await db()).delete("queue", [id, cid, seq]);
}

export async function queueClear(id: string): Promise<void> {
  await (await db()).delete(
    "queue",
    IDBKeyRange.bound([id, "", 0], [id, "￿", Infinity]),
  );
}

// atomic across tabs — two tabs on one board must never mint the same seq
export async function nextSeq(id: string): Promise<number> {
  const tx = (await db()).transaction("meta", "readwrite");
  const key = `seq:${id}`;
  const n = (((await tx.store.get(key)) as number) ?? 0) + 1;
  await tx.store.put(n, key);
  await tx.done;
  return n;
}

// fast-forward past the server's last-seen seq — a counter behind the server's
// (storage eviction) would mint seqs the server silently drops as duplicates
export async function bumpSeq(id: string, to: number): Promise<void> {
  if (!to) return;
  const tx = (await db()).transaction("meta", "readwrite");
  const key = `seq:${id}`;
  const n = ((await tx.store.get(key)) as number) ?? 0;
  if (to > n) await tx.store.put(to, key);
  await tx.done;
}
