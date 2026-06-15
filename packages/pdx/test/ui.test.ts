import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { makeEngine, liveServices } from "@pdx/pithos";
import { uiPdx } from "../src/controller.js";
import { HttpLive } from "../src/live.js";
import { Browser, Http, Signals } from "../src/services.js";
import { parseConfig, run } from "./support.js";

const tempDirs: string[] = [];

const createUiFixture = async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "pdx-ui-"));
	tempDirs.push(dataDir);
	await mkdir(join(dataDir, "repo"), { recursive: true });
	const dbPath = join(dataDir, "pithos.sqlite");
	const engine = makeEngine({
		config: { dbPath, runId: "run_pdx_ui_test" },
		services: liveServices,
	});
	engine.init({ fresh: true });
	return {
		dataDir,
		config: await parseConfig(dataDir),
	};
};

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir !== undefined) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

describe("pdx ui", () => {
	it("starts the explorer, opens the browser, and stops cleanly on interrupt", async () => {
		const fixture = await createUiFixture();
		const ready = await run(Deferred.make<{ readonly url: string; readonly port: number }>());
		const stop = await run(Deferred.make<"SIGINT" | "SIGTERM">());
		let openedUrl: string | undefined;

		const browser = Browser.of({
			open: (url) =>
				Effect.sync(() => {
					openedUrl = url;
				}),
		});
		const signals = Signals.of({
			waitForInterrupt: () => Deferred.await(stop),
		});

		const fiber = Effect.runFork(
			uiPdx(fixture.config, {
				host: "127.0.0.1",
				port: 0,
				noOpen: false,
				onReady: ({ url, port }) => Deferred.succeed(ready, { url, port }),
			}).pipe(
				Effect.provideService(Browser, browser),
				Effect.provideService(Http, HttpLive),
				Effect.provideService(Signals, signals),
			),
		);

		const info = await run(Deferred.await(ready));
		expect(info.port).toBeGreaterThan(0);
		expect(openedUrl).toBe(info.url);

		const health = await fetch(`${info.url}/api/health`);
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ ok: true });

		await run(Deferred.succeed(stop, "SIGINT"));
		await run(Fiber.join(fiber));

		await expect(fetch(`${info.url}/api/health`)).rejects.toThrow();
	});

	it("skips browser launch when --no-open is set", async () => {
		const fixture = await createUiFixture();
		const stop = await run(Deferred.make<"SIGINT" | "SIGTERM">());
		let openCount = 0;

		await run(
			uiPdx(fixture.config, {
				host: "127.0.0.1",
				port: 0,
				noOpen: true,
				onReady: () => Deferred.succeed(stop, "SIGTERM"),
			}).pipe(
				Effect.provideService(
					Browser,
					Browser.of({
						open: () =>
							Effect.sync(() => {
								openCount += 1;
							}),
					}),
				),
				Effect.provideService(Http, HttpLive),
				Effect.provideService(
					Signals,
					Signals.of({
						waitForInterrupt: () => Deferred.await(stop),
					}),
				),
			),
		);

		expect(openCount).toBe(0);
	});

	it("allows explicit LAN binding hosts and rejects malformed hosts", async () => {
		const fixture = await createUiFixture();
		const stop = await run(Deferred.make<"SIGINT" | "SIGTERM">());
		const ready = await run(Deferred.make<{ readonly host: string; readonly url: string }>());

		await run(
			uiPdx(fixture.config, {
				host: "0.0.0.0",
				port: 0,
				noOpen: true,
				onReady: ({ host, url }) =>
					Deferred.succeed(ready, { host, url }).pipe(
						Effect.zipRight(Deferred.succeed(stop, "SIGTERM")),
					),
			}).pipe(
				Effect.provideService(Browser, Browser.of({ open: () => Effect.void })),
				Effect.provideService(Http, HttpLive),
				Effect.provideService(
					Signals,
					Signals.of({ waitForInterrupt: () => Deferred.await(stop) }),
				),
			),
		);
		expect(await run(Deferred.await(ready))).toEqual(expect.objectContaining({ host: "0.0.0.0" }));

		await expect(
			run(
				uiPdx(fixture.config, {
					host: "not a host",
					port: 0,
					noOpen: true,
				}).pipe(
					Effect.provideService(Browser, Browser.of({ open: () => Effect.void })),
					Effect.provideService(Http, HttpLive),
					Effect.provideService(
						Signals,
						Signals.of({ waitForInterrupt: () => Effect.succeed("SIGINT") }),
					),
				),
			),
		).rejects.toThrow(/--host must be localhost or a valid IPv4\/IPv6 address/);
	});

	it("fails before announcing readiness when the Pithos DB is missing", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-ui-missing-db-"));
		tempDirs.push(dataDir);
		const config = await parseConfig(dataDir);
		let opened = false;

		await expect(
			run(
				uiPdx(config, {
					host: "127.0.0.1",
					port: 0,
					noOpen: false,
				}).pipe(
					Effect.provideService(
						Browser,
						Browser.of({
							open: () =>
								Effect.sync(() => {
									opened = true;
								}),
						}),
					),
					Effect.provideService(Http, HttpLive),
					Effect.provideService(
						Signals,
						Signals.of({ waitForInterrupt: () => Effect.succeed("SIGINT") }),
					),
				),
			),
		).rejects.toThrow(/Pithos DB not found/);
		expect(opened).toBe(false);
	});
});
