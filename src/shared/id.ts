export function uid(): string {
  return crypto.randomUUID();
}

const ADJ = "quiet brave calm swift keen bold warm cool deft glad neat spry fond wise late early lucky merry plain proud rapid rare ripe rosy round royal sharp sleek small solid steep still sunny".split(" ");
const NOUN = "otter heron maple cedar river stone cloud ember frost gull kestrel lark lynx moss owl pike reed sable teal wren aspen birch brook cliff dune fern gorse holly iris juniper kelp loch".split(" ");
const B32 = "abcdefghjkmnpqrstuvwxyz23456789";

// adjective-noun + 5 random chars ≈ 35 bits — unguessable enough behind
// "empty boards persist nothing" + rate limiting; renameable anyway.
export function randomSlug(): string {
  const r = new Uint8Array(7);
  crypto.getRandomValues(r);
  let tail = "";
  for (let i = 0; i < 5; i++) tail += B32[r[i + 2] % B32.length];
  return `${ADJ[r[0] % ADJ.length]}-${NOUN[r[1] % NOUN.length]}-${tail}`;
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
