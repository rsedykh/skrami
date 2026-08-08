import { describe, expect, it } from "vitest";
import { keyBetween, sortByKey } from "../src/shared/orderKey";

function check(a: string | null, b: string | null): string {
  const k = keyBetween(a, b);
  if (a !== null) expect(k > a).toBe(true);
  if (b !== null) expect(k < b).toBe(true);
  expect(k.endsWith("0")).toBe(false);
  expect(k).not.toBe("");
  return k;
}

describe("keyBetween", () => {
  it("throws on a >= b", () => {
    expect(() => keyBetween("a", "a")).toThrow();
    expect(() => keyBetween("b", "a")).toThrow();
  });

  it("survives sequential append", () => {
    let prev: string | null = null;
    for (let i = 0; i < 500; i++) prev = check(prev, null);
  });

  it("survives sequential prepend", () => {
    let next: string | null = null;
    for (let i = 0; i < 500; i++) next = check(null, next);
  });

  it("survives repeatedly splitting the same gap", () => {
    let lo = check(null, null);
    const hi = check(lo, null);
    for (let i = 0; i < 200; i++) lo = check(lo, hi);
    let hi2 = hi;
    for (let i = 0; i < 200; i++) hi2 = check(lo, hi2);
  });

  it("keeps a randomly grown list strictly ordered", () => {
    const keys = [check(null, null)];
    for (let i = 0; i < 5000; i++) {
      const pos = Math.floor(Math.random() * (keys.length + 1));
      const a = pos === 0 ? null : keys[pos - 1];
      const b = pos === keys.length ? null : keys[pos];
      keys.splice(pos, 0, check(a, b));
    }
    for (let j = 1; j < keys.length; j++) expect(keys[j - 1] < keys[j]).toBe(true);
  });
});

describe("sortByKey", () => {
  it("orders by key, then id as tiebreak", () => {
    const items = [
      { orderKey: "b", id: "2" },
      { orderKey: "a", id: "9" },
      { orderKey: "b", id: "1" },
    ];
    expect(sortByKey(items).map((i) => i.id)).toEqual(["9", "1", "2"]);
  });
});
