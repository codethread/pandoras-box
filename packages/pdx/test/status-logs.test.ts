import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { PdxError } from "../src/errors.js";
import { Clock, FileSystem, PithosClient, Tmux } from "../src/services.js";
import { DAEMON_TARGET, logsShowPdx, statusPdx } from "../src/controller.js";
import { run, parseConfig, makePithos, testClock, fakeTmux, fakeFs } from "./support.js";

describe("pdx status and logs show", () => {
	it("status returns required top-level keys when daemon is down", async () => {
		const tmux = fakeTmux({ hasSession: () => Effect.succeed(false) });
		const pithosCalls: string[] = [];
		const pithos = makePithos(pithosCalls, [{ scope_id: "global", capability: "escalate" }]);
		const fs = fakeFs();
		const status = await run(
			statusPdx(await parseConfig("/tmp/pdx-home"), 7).pipe(
				Effect.provideService(Tmux, tmux),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(pithosCalls).toEqual(["init"]);
		expect(status).toEqual({
			daemon: { running: false, target: DAEMON_TARGET, socket_path: "/tmp/pdx-home/pdx.sock" },
			registry: { entries: [] },
			queue: { claimable: 1, by_scope_capability: { global: { escalate: 1 } } },
			caps: { max_afk: 7, afk_used: 0 },
		});
	});

	it("status fails loudly on tmux status errors", async () => {
		const tmux = fakeTmux({
			hasSession: () =>
				Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "tmux exploded" })),
		});
		const pithos = makePithos();
		const fs = fakeFs();
		await expect(
			run(
				statusPdx(await parseConfig("/tmp/pdx-home"), 4).pipe(
					Effect.provideService(Tmux, tmux),
					Effect.provideService(PithosClient, pithos),
					Effect.provideService(FileSystem, fs),
					Effect.provideService(Clock, testClock),
				),
			),
		).rejects.toThrow("tmux exploded");
	});

	it("logs show preserves raw JSONL and applies default limit, explicit limit, all, and since", async () => {
		const lines = Array.from({ length: 101 }, (_, index) =>
			JSON.stringify({
				ts: new Date(Date.UTC(2026, 4, 9, 0, index, 0)).toISOString(),
				level: "info",
				span: "test",
				msg: `line-${index}`,
			}),
		);
		const fs = fakeFs({ readFile: () => Effect.succeed(`${lines.join("\n")}\n`) });
		const config = await parseConfig("/tmp/pdx-home");
		const defaultOutput = await run(
			logsShowPdx(config, { limit: undefined, all: false, since: undefined }).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(defaultOutput).toBe(`${lines.slice(1).join("\n")}\n`);
		const sinceClock = Clock.of({ nowIso: Effect.succeed("2026-05-09T01:40:00.000Z") });
		const limitOutput = await run(
			logsShowPdx(config, { limit: 2, all: false, since: undefined }).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(limitOutput).toBe(`${lines.slice(-2).join("\n")}\n`);
		const allOutput = await run(
			logsShowPdx(config, { limit: undefined, all: true, since: undefined }).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(allOutput).toBe(`${lines.join("\n")}\n`);
		const sinceOutput = await run(
			logsShowPdx(config, {
				limit: undefined,
				all: true,
				since: new Date(Date.UTC(2026, 4, 9, 1, 39, 0)).toISOString(),
			}).pipe(Effect.provideService(FileSystem, fs), Effect.provideService(Clock, sinceClock)),
		);
		expect(sinceOutput).toBe(`${lines.slice(99).join("\n")}\n`);
	});

	it("logs show accepts documented since forms and rejects malformed input and corrupt JSONL", async () => {
		const line = JSON.stringify({
			ts: new Date().toISOString(),
			level: "info",
			span: "test",
			msg: "line",
		});
		const fs = fakeFs({ readFile: () => Effect.succeed(`${line}\n`) });
		const config = await parseConfig("/tmp/pdx-home");
		const logsClock = Clock.of({ nowIso: Effect.succeed("2026-05-09T01:40:00.000Z") });
		for (const since of [
			"10m",
			"1h",
			"2d",
			"1w",
			"today",
			"yesterday",
			"2026-05-09T00:00:00.000Z",
		]) {
			await expect(
				run(
					logsShowPdx(config, { limit: undefined, all: true, since }).pipe(
						Effect.provideService(FileSystem, fs),
						Effect.provideService(Clock, logsClock),
					),
				),
			).resolves.toEqual(expect.any(String));
		}
		await expect(
			run(
				logsShowPdx(config, { limit: undefined, all: true, since: "soon" }).pipe(
					Effect.provideService(FileSystem, fs),
					Effect.provideService(Clock, logsClock),
				),
			),
		).rejects.toThrow("invalid --since value");
		const corruptFs = fakeFs({ readFile: () => Effect.succeed("{\n") });
		await expect(
			run(
				logsShowPdx(config, { limit: undefined, all: true, since: undefined }).pipe(
					Effect.provideService(FileSystem, corruptFs),
					Effect.provideService(Clock, testClock),
				),
			),
		).rejects.toThrow("corrupt supervisor log JSONL");
		const blankLineFs = fakeFs({ readFile: () => Effect.succeed(`${line}\n\n${line}\n`) });
		await expect(
			run(
				logsShowPdx(config, { limit: undefined, all: true, since: undefined }).pipe(
					Effect.provideService(FileSystem, blankLineFs),
					Effect.provideService(Clock, testClock),
				),
			),
		).rejects.toThrow("corrupt supervisor log JSONL");
	});
});
