// Fractional indexing: keyBetween(a, b) returns a string strictly between a and b
// (null = open end). Keys never end in the zero digit, so a midpoint always exists.
const D = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  return midpoint(a ?? "", b ?? "");
}

function midpoint(a: string, b: string): string {
  if (b !== "") {
    let n = 0;
    while ((a[n] ?? D[0]) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a === "" ? 0 : D.indexOf(a[0]);
  const db = b === "" ? D.length : D.indexOf(b[0]);
  if (db - da > 1) return D[Math.round((da + db) / 2)];
  if (b.length > 1) return b[0];
  return D[da] + midpoint(a.slice(1), "");
}

export function sortByKey<T extends { orderKey: string; id: string }>(items: T[]): T[] {
  return items.sort((x, y) =>
    x.orderKey < y.orderKey ? -1 : x.orderKey > y.orderKey ? 1 : x.id < y.id ? -1 : 1,
  );
}
