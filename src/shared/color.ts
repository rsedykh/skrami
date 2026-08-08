// Deterministic name → pastel. Colors are coordinated per board: every client
// derives the same name set from the same state, so slot assignment agrees
// everywhere without anything being stored.
const SLOTS = 12; // 30° apart — still tellable-apart at pastel saturation; boards with more names wrap

function hash(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

function pastel(hue: number): { c: string; a: string } {
  return { c: `hsl(${hue} 70% 89%)`, a: `hsl(${hue} 55% 74%)` };
}

// Uncoordinated fallback for a name outside any known set (e.g. a mid-typing preview).
export function colorFor(name: string): { c: string; a: string } {
  return pastel(hash(name.trim().toLowerCase()) % 360);
}

// Distinct hues for up to 12 names: each claims its hashed slot, probing past taken
// ones. Claims happen in sorted order, so every client resolves collisions alike.
export function colorMap(names: string[]): Map<string, { c: string; a: string }> {
  const keys = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].sort();
  const taken = new Array<boolean>(SLOTS).fill(false);
  const m = new Map<string, { c: string; a: string }>();
  for (const k of keys) {
    let s = hash(k) % SLOTS;
    for (let i = 1; i < SLOTS && taken[s]; i++) s = (s + 1) % SLOTS;
    taken[s] = true;
    m.set(k, pastel(s * (360 / SLOTS)));
  }
  return m;
}
