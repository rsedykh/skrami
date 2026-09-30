// The static-asset layer answers Range requests with the whole file (200, verified on prod).
// Media players — iOS Safari above all — want 206 slices to play and seek, so media assets are
// routed through the Worker (wrangler.jsonc run_worker_first) and sliced here. Single ranges only;
// anything else gets the whole file, which RFC 9110 allows.
export async function byteRange(res: Response, range: string | null): Promise<Response> {
  const headers = new Headers(res.headers);
  headers.set("accept-ranges", "bytes");
  const m = range && res.status === 200 ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!m || (!m[1] && !m[2])) return new Response(res.body, { status: res.status, headers });

  const body = await res.arrayBuffer();
  const size = body.byteLength;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end || start >= size)
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}`, "accept-ranges": "bytes" } });

  headers.delete("content-encoding"); // the slice is of the decoded body
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
