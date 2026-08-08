import { boardIdFrom } from "../shared/id";

export { BoardDO } from "./boardDO";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/b\/([^/]+)(\/(?:ws|auth))?$/);
    if (!m) return env.ASSETS.fetch(req);

    const [, seg, sub] = m;
    // identity is the trailing token; the flavor words before it are ignored
    let id: string | null = null;
    try {
      id = boardIdFrom(decodeURIComponent(seg));
    } catch {}
    if (!id) {
      // a truncated or hand-mangled link shouldn't mint a junk board
      if (sub) return new Response("Bad board id", { status: 400 });
      return Response.redirect(new URL("/", url).toString(), 302);
    }
    if (sub) return env.BOARD.get(env.BOARD.idFromName(id)).fetch(new Request(new URL(`/b/${id}${sub}`, url), req));
    // extensionless: the asset layer 307s "/board.html" away from under us
    return env.ASSETS.fetch(new Request(new URL("/board", url), req));
  },
} satisfies ExportedHandler<Env>;
