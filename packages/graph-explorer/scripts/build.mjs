import * as esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const distDir = resolve(pkgRoot, "dist");
const args = new Set(process.argv.slice(2));
const dev = args.has("--dev");

await mkdir(distDir, { recursive: true });

await esbuild.build({
	entryPoints: [resolve(pkgRoot, "src/index.ts")],
	outfile: resolve(distDir, "index.js"),
	platform: "node",
	target: "es2024",
	format: "esm",
	bundle: true,
	sourcemap: dev ? "inline" : false,
	external: ["@pdx/pithos"],
});

await esbuild.build({
	entryPoints: [resolve(pkgRoot, "src/frontend/frontend.ts")],
	outfile: resolve(distDir, "frontend.js"),
	platform: "browser",
	target: "es2024",
	format: "esm",
	bundle: true,
	sourcemap: dev ? "inline" : false,
});

await esbuild.build({
	entryPoints: [resolve(pkgRoot, "src/frontend/graph/layout-worker.ts")],
	outfile: resolve(distDir, "layout-worker.js"),
	platform: "browser",
	target: "es2024",
	format: "esm",
	bundle: true,
	sourcemap: dev ? "inline" : false,
});

await cp(resolve(pkgRoot, "src/frontend/index.html"), resolve(distDir, "index.html"));
await cp(resolve(pkgRoot, "src/frontend/index.css"), resolve(distDir, "index.css"));
