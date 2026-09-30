import * as esbuild from "esbuild";
import { spawn } from "node:child_process";

const dev = process.argv.includes("--dev");

const options = {
  entryPoints: [
    "src/client/board.ts",
    "src/client/index.ts",
    "src/client/sw.js",
    "src/client/app.css",
    "src/client/board.html",
    "src/client/index.html",
    "src/client/manifest.webmanifest",
    "src/client/icon.svg",
    "src/client/robots.txt",
    "src/client/llms.txt",
    "src/client/promo.mp4",
    "src/client/promo.jpg",
  ],
  bundle: true,
  format: "esm",
  outdir: "dist",
  loader: { ".html": "copy", ".webmanifest": "copy", ".svg": "copy", ".txt": "copy", ".mp4": "copy", ".jpg": "copy" },
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "info",
};

if (dev) {
  const ctx = await esbuild.context(options);
  await ctx.rebuild();
  await ctx.watch();
  const wrangler = spawn("pnpm", ["exec", "wrangler", "dev"], { stdio: "inherit" });
  wrangler.on("exit", (code) => process.exit(code ?? 0));
} else {
  await esbuild.build(options);
}
