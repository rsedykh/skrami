import { describe, expect, it } from "vitest";
import { NAME_RE, boardIdFrom, flavorFrom, newBoardPath, randomBoardId } from "../src/shared/id";

describe("board ids", () => {
  it("parses the trailing token as the identity", () => {
    expect(boardIdFrom("quiet-otter-abc23de")).toBe("abc23de");
    expect(boardIdFrom("abc23de")).toBe("abc23de");
    expect(flavorFrom("quiet-otter-abc23de")).toBe("quiet-otter");
    expect(flavorFrom("abc23de")).toBe("");
  });

  it("rejects truncated or mangled addresses", () => {
    expect(boardIdFrom("quiet-otter")).toBeNull(); // flavor alone — id lost in copy-paste
    expect(boardIdFrom("quiet-otter-")).toBeNull();
    expect(boardIdFrom("")).toBeNull();
    expect(boardIdFrom("quiet-otter-abcldef")).toBeNull(); // l is not in the alphabet
    expect(boardIdFrom("quiet-otter-ABC23DE")).toBeNull();
    expect(boardIdFrom("quiet-otter-abc23d")).toBeNull(); // too short
  });

  it("generates ids the parser accepts, every time", () => {
    for (let i = 0; i < 200; i++) {
      const id = randomBoardId();
      expect(id).toHaveLength(7);
      expect(boardIdFrom(id)).toBe(id);
    }
  });

  it("new board paths round-trip through the parser", () => {
    for (let i = 0; i < 50; i++) {
      const seg = newBoardPath().slice("/b/".length);
      expect(boardIdFrom(seg)).not.toBeNull();
      expect(flavorFrom(seg)).toMatch(/^[a-z]+-[a-z]+$/);
    }
  });
});

describe("NAME_RE", () => {
  it("accepts URL-safe names and nothing else", () => {
    expect(NAME_RE.test("sprint-42")).toBe(true);
    expect(NAME_RE.test("a")).toBe(true);
    expect(NAME_RE.test("a".repeat(50))).toBe(true);
    expect(NAME_RE.test("a".repeat(51))).toBe(false);
    expect(NAME_RE.test("Upper")).toBe(false);
    expect(NAME_RE.test("-edge")).toBe(false);
    expect(NAME_RE.test("edge-")).toBe(false);
    expect(NAME_RE.test("")).toBe(false);
    expect(NAME_RE.test("two words")).toBe(false);
  });
});
