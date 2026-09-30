import { describe, expect, it } from "vitest";
import { byteRange } from "../src/server/range";

const file = () => new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { headers: { "content-type": "video/mp4" } });
const bytes = async (r: Response) => [...new Uint8Array(await r.arrayBuffer())];

describe("byteRange", () => {
  it("no Range: whole file, advertises ranges", async () => {
    const r = await byteRange(file(), null);
    expect(r.status).toBe(200);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(await bytes(r)).toHaveLength(10);
  });

  it("the probe iOS sends first: bytes=0-1", async () => {
    const r = await byteRange(file(), "bytes=0-1");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-1/10");
    expect(r.headers.get("content-length")).toBe("2");
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(await bytes(r)).toEqual([0, 1]);
  });

  it("open-ended, suffix and over-long ranges", async () => {
    expect(await bytes(await byteRange(file(), "bytes=7-"))).toEqual([7, 8, 9]);
    expect(await bytes(await byteRange(file(), "bytes=-3"))).toEqual([7, 8, 9]);
    const r = await byteRange(file(), "bytes=8-100");
    expect(r.headers.get("content-range")).toBe("bytes 8-9/10");
  });

  it("unsatisfiable range: 416", async () => {
    const r = await byteRange(file(), "bytes=20-");
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe("bytes */10");
  });

  it("multi-range or garbage: whole file", async () => {
    for (const h of ["bytes=0-1,5-6", "items=0-1", "bytes=-"]) {
      const r = await byteRange(file(), h);
      expect(r.status).toBe(200);
      expect(await bytes(r)).toHaveLength(10);
    }
  });

  it("non-200 upstream passes through untouched", async () => {
    const r = await byteRange(new Response("nope", { status: 404 }), "bytes=0-1");
    expect(r.status).toBe(404);
  });
});
