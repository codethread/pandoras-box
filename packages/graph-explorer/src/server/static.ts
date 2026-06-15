import type { ServerResponse } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GraphExplorerError } from "../errors.js";
import type { ServerServices } from "./services.js";

interface StaticAsset {
	readonly relativePath: string;
	readonly contentType: string;
	readonly cacheControl: string;
	readonly sourceFallbackRelativePath?: string;
	readonly placeholderBody?: () => string;
}

const STATIC_ASSETS = new Map<string, StaticAsset>([
	[
		"/index.html",
		{
			relativePath: "index.html",
			contentType: "text/html; charset=utf-8",
			cacheControl: "no-cache",
			sourceFallbackRelativePath: "index.html",
		},
	],
	[
		"/index.css",
		{
			relativePath: "index.css",
			contentType: "text/css; charset=utf-8",
			cacheControl: "no-cache",
			sourceFallbackRelativePath: "index.css",
		},
	],
	[
		"/frontend.js",
		{
			relativePath: "frontend.js",
			contentType: "text/javascript; charset=utf-8",
			cacheControl: "no-cache",
			placeholderBody: () =>
				[
					"globalThis.__PDX_GRAPH_EXPLORER_RUNTIME__ = {",
					'  kind: "placeholder",',
					'  message: "Frontend runtime wiring is scaffolded while the browser UI lands in a later slice."',
					"};",
				].join("\n"),
		},
	],
	[
		"/layout-worker.js",
		{
			relativePath: "layout-worker.js",
			contentType: "text/javascript; charset=utf-8",
			cacheControl: "no-cache",
			placeholderBody: () =>
				[
					"globalThis.__PDX_GRAPH_EXPLORER_LAYOUT_WORKER__ = {",
					'  kind: "placeholder",',
					'  message: "Layout worker wiring is scaffolded while the browser graph renderer lands in a later slice."',
					"};",
				].join("\n"),
		},
	],
]);

let packageRootPromise: Promise<string> | undefined;

const hasGraphExplorerAssets = async (root: string, services: ServerServices): Promise<boolean> =>
	(await services.fileSystem.fileExists(resolve(root, "dist", "index.html"))) ||
	(await services.fileSystem.fileExists(resolve(root, "src", "frontend", "index.html")));

const findPackageRoot = async (startDir: string, services: ServerServices): Promise<string> => {
	const candidates = [
		startDir,
		process.cwd(),
		resolve(process.cwd(), "..", "graph-explorer"),
		resolve(process.cwd(), "packages", "graph-explorer"),
	];
	for (const candidate of candidates) {
		if (await hasGraphExplorerAssets(candidate, services)) {
			return candidate;
		}
	}

	let currentDir = startDir;
	while (true) {
		if (await hasGraphExplorerAssets(currentDir, services)) {
			return currentDir;
		}

		const siblingGraphExplorer = resolve(currentDir, "packages", "graph-explorer");
		if (await hasGraphExplorerAssets(siblingGraphExplorer, services)) {
			return siblingGraphExplorer;
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			throw new GraphExplorerError({
				code: "STATIC_ASSET_NOT_FOUND",
				message: "Unable to resolve graph explorer package root for static assets",
			});
		}

		currentDir = parentDir;
	}
};

const packageRoot = async (services: ServerServices): Promise<string> => {
	packageRootPromise ??= findPackageRoot(dirname(fileURLToPath(import.meta.url)), services);
	return packageRootPromise;
};

const resolveStaticAssetText = async (
	asset: StaticAsset,
	services: ServerServices,
): Promise<string> => {
	const root = await packageRoot(services);
	const distPath = resolve(root, "dist", asset.relativePath);
	if (await services.fileSystem.fileExists(distPath)) {
		return services.fileSystem.readTextFile(distPath);
	}

	if (asset.sourceFallbackRelativePath !== undefined) {
		const sourcePath = resolve(root, "src/frontend", asset.sourceFallbackRelativePath);
		if (await services.fileSystem.fileExists(sourcePath)) {
			return services.fileSystem.readTextFile(sourcePath);
		}
	}

	if (asset.placeholderBody !== undefined) {
		return asset.placeholderBody();
	}

	throw new GraphExplorerError({
		code: "STATIC_ASSET_NOT_FOUND",
		message: `Static asset '${asset.relativePath}' is unavailable`,
	});
};

const writeText = (
	response: ServerResponse,
	statusCode: number,
	body: string,
	contentType: string,
	cacheControl: string,
): void => {
	response.statusCode = statusCode;
	response.setHeader("cache-control", cacheControl);
	response.setHeader("content-type", contentType);
	response.end(body);
};

const shouldServeSpaShell = (pathname: string): boolean => {
	if (pathname === "/") {
		return true;
	}
	if (pathname.startsWith("/api/") || pathname === "/ws/graph") {
		return false;
	}
	return extname(pathname).length === 0;
};

export const serveStaticRequest = async (
	pathname: string,
	response: ServerResponse,
	services: ServerServices,
): Promise<boolean> => {
	const assetPath = shouldServeSpaShell(pathname) ? "/index.html" : pathname;
	const staticAsset = STATIC_ASSETS.get(assetPath);
	if (staticAsset === undefined) {
		return false;
	}

	const assetBody = await resolveStaticAssetText(staticAsset, services);
	writeText(response, 200, assetBody, staticAsset.contentType, staticAsset.cacheControl);
	return true;
};
