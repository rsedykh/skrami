import { openDB, type IDBPDatabase } from "idb";
import type { Board, Envelope } from "../shared/types";

export type CachedBoard = { board: Board; version: number };
export type QueueRow = { slug: string; cid: string; seq: number; env: Envelope };

let dbp: Promise<IDBPDatabase> | undefined;

function db(): Promise<IDBPDatabase> {
  dbp ??= openDB("skrami", 1, {
    upgrade(d) {
      d.createObjectStore("boards");
      d.createObjectStore("queue", { keyPath: ["slug", "cid", "seq"] });
      d.createObjectStore("meta");
    },
  });
  return dbp;
}

export async function cacheGet(slug: string): Promise<CachedBoard | undefined> {
  return (await db()).get("boards", slug);
}

export async function cachePut(slug: string, value: CachedBoard): Promise<void> {
  await (await db()).put("boards", value, slug);
}

export async function cacheDel(slug: string): Promise<void> {
  const d = await db();
  await d.delete("boards", slug);
  await queueClear(slug);
}

export async function queueList(slug: string): Promise<QueueRow[]> {
  const rows: QueueRow[] = await (await db()).getAll(
    "queue",
    IDBKeyRange.bound([slug, "", 0], [slug, "￿", Infinity]),
  );
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function queuePut(row: QueueRow): Promise<void> {
  await (await db()).put("queue", row);
}

export async function queueDel(slug: string, cid: string, seq: number): Promise<void> {
  await (await db()).delete("queue", [slug, cid, seq]);
}

export async function queueClear(slug: string): Promise<void> {
  await (await db()).delete(
    "queue",
    IDBKeyRange.bound([slug, "", 0], [slug, "￿", Infinity]),
  );
}

// atomic across tabs — two tabs on one board must never mint the same seq
export async function nextSeq(slug: string): Promise<number> {
  const tx = (await db()).transaction("meta", "readwrite");
  const key = `seq:${slug}`;
  const n = (((await tx.store.get(key)) as number) ?? 0) + 1;
  await tx.store.put(n, key);
  await tx.done;
  return n;
}
