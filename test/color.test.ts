import { describe, expect, it } from "vitest";
import { colorMap } from "../src/shared/color";

describe("colorMap", () => {
  it("assigns the same colors no matter the input order or spelling noise", () => {
    const a = colorMap(["Alice", "bob", "Cara"]);
    const b = colorMap(["  CARA ", "ALICE", "Bob", "alice"]);
    expect(a.get("alice")).toEqual(b.get("alice"));
    expect(a.get("bob")).toEqual(b.get("bob"));
    expect(a.get("cara")).toEqual(b.get("cara"));
  });

  it("gives 12 names 12 distinct hues", () => {
    const names = Array.from({ length: 12 }, (_, i) => `person${i}`);
    const m = colorMap(names);
    expect(new Set([...m.values()].map((v) => v.c)).size).toBe(12);
  });
});
