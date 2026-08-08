import { SLUG_RE } from "../shared/id";

export { BoardDO } from "./boardDO";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/b\/([^/]+)(\/(?:ws|auth))?$/);
    if (!m) return env.ASSETS.fetch(req);

    const [, slug, sub] = m;
    if (!SLUG_RE.test(slug)) return new Response("Bad board name", { status: 400 });
    if (sub) return env.BOARD.get(env.BOARD.idFromName(slug)).fetch(req);
    // extensionless: the asset layer 307s "/board.html" away from under us
    return env.ASSETS.fetch(new Request(new URL("/board", url), req));
  },
} satisfies ExportedHandler<Env>;
