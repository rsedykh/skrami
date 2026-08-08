export function uid(): string {
  return crypto.randomUUID();
}

const ADJ = "quiet brave calm swift keen bold warm cool deft glad neat spry fond wise late early lucky merry plain proud rapid rare ripe rosy round royal sharp sleek small solid steep still sunny".split(" ");
const NOUN = "otter heron maple cedar river stone cloud ember frost gull kestrel lark lynx moss owl pike reed sable teal wren aspen birch brook cliff dune fern gorse holly iris juniper kelp loch".split(" ");
const B32 = "abcdefghjkmnpqrstuvwxyz23456789";

// A board's identity is its id — the final hyphen-separated token of the URL
// segment. Everything before it is flavor: a display name that renames freely
// without moving any data. 7 chars of the 31-char alphabet ≈ 35 bits.
export const ID_LEN = 7;
const ID_RE = /^[a-hjkmnp-z2-9]{7}$/; // exactly B32: no i, l, o, 0, 1

export function randomBoardId(): string {
  const r = new Uint8Array(ID_LEN);
  crypto.getRandomValues(r);
  let id = "";
  for (const b of r) id += B32[b % B32.length];
  return id;
}

export function randomFlavor(): string {
  const r = new Uint8Array(2);
  crypto.getRandomValues(r);
  return `${ADJ[r[0] % ADJ.length]}-${NOUN[r[1] % NOUN.length]}`;
}

export function newBoardPath(): string {
  return `/b/${randomFlavor()}-${randomBoardId()}`;
}

export function boardIdFrom(seg: string): string | null {
  const tok = seg.slice(seg.lastIndexOf("-") + 1);
  return ID_RE.test(tok) ? tok : null;
}

export function flavorFrom(seg: string): string {
  const i = seg.lastIndexOf("-");
  return i > 0 ? seg.slice(0, i) : "";
}

// Board names become the flavor part of the URL, so they keep the slug charset.
export const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
