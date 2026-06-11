import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Clock, Ids, makeRegistry, Process } from "../src/services.js";
import { makeTmux } from "../src/tmux.js";
import { PANDORA_TARGET } from "../src/controller.js";
import {
	run,
	parseConfig,
	makePithos,
	runTick,
	upsertPandora,
	fakeTmux,
	fakeProcess,
	type ReadyTaskInput,
} from "./support.js";

describe("pdx pandora nudge", () => {
	it("wakes Pandora exactly when global escalate work transitions to claimable", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		let ready: readonly ReadyTaskInput[] = [];
		const sends: string[] = [];
		const config = await parseConfig(dataDir);
		const tick = () =>
			runTick({
				config,
				registry,
				pithos: makePithos([], () => ready),
				tmux: fakeTmux({
					sendLiteralLine: (target, text) => Effect.sync(() => sends.push(`${target}:${text}`)),
				}),
				ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
			});
		await tick();
		expect(sends).toEqual([]);
		ready = [{ scope_id: "global", capability: "escalate" }];
		await tick();
		expect(sends).toEqual([`${PANDORA_TARGET}:<pithos-event>escalation-ready</pithos-event>`]);
		await tick();
		expect(sends).toHaveLength(1);
		ready = [
			{ scope_id: "global", capability: "escalate" },
			{ scope_id: "global", capability: "escalate" },
		];
		await tick();
		expect(sends).toHaveLength(1);
		ready = [];
		await tick();
		ready = [{ scope_id: "global", capability: "escalate" }];
		await tick();
		expect(sends).toHaveLength(2);
	});

	it("defers nudge and sets pendingNudgeSince when operator is actively typing", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const sends: string[] = [];
		const nowIso = "2026-05-09T00:00:31.000Z";
		const nowUnix = Math.floor(Date.parse(nowIso) / 1000);
		const ready = [{ scope_id: "global", capability: "escalate" as const }];
		const config = await parseConfig(dataDir);
		const tick = () =>
			runTick({
				config,
				registry,
				pithos: makePithos([], () => ready),
				tmux: fakeTmux({
					sendLiteralLine: (target, text) => Effect.sync(() => sends.push(`${target}:${text}`)),
					presence: () => Effect.succeed({ attached: 1, lastActivityUnix: nowUnix - 1 }),
				}),
				ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
				clock: Clock.of({ nowIso: Effect.succeed(nowIso) }),
			});
		await tick();
		expect(sends).toEqual([]);
		expect(await run(registry.pendingNudgeSince)).toBe(nowIso);
		// second tick still deferred; pendingNudgeSince is not overwritten
		await tick();
		expect(sends).toEqual([]);
		expect(await run(registry.pendingNudgeSince)).toBe(nowIso);
	});

	it("sends nudge immediately when operator activity exceeds ACTIVE_WINDOW_SECONDS", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const sends: string[] = [];
		const nowIso = "2026-05-09T00:00:31.000Z";
		const nowUnix = Math.floor(Date.parse(nowIso) / 1000);
		const config = await parseConfig(dataDir);
		await runTick({
			config,
			registry,
			pithos: makePithos([], [{ scope_id: "global", capability: "escalate" }]),
			tmux: fakeTmux({
				sendLiteralLine: (target, text) => Effect.sync(() => sends.push(`${target}:${text}`)),
				presence: () => Effect.succeed({ attached: 1, lastActivityUnix: nowUnix - 5 }),
			}),
			ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
			clock: Clock.of({ nowIso: Effect.succeed(nowIso) }),
		});
		expect(sends).toEqual([`${PANDORA_TARGET}:<pithos-event>escalation-ready</pithos-event>`]);
		expect(await run(registry.pendingNudgeSince)).toBeNull();
	});

	it("force-sends nudge after DEBOUNCE_MAX_SECONDS even while operator is typing", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const sends: string[] = [];
		const baseIso = "2026-05-09T00:00:31.000Z";
		const baseUnix = Math.floor(Date.parse(baseIso) / 1000);
		let currentNowIso = baseIso;
		const config = await parseConfig(dataDir);
		const tick = () =>
			runTick({
				config,
				registry,
				pithos: makePithos([], [{ scope_id: "global", capability: "escalate" }]),
				tmux: fakeTmux({
					sendLiteralLine: (target, text) => Effect.sync(() => sends.push(`${target}:${text}`)),
					presence: () =>
						Effect.sync(() => ({
							attached: 1,
							lastActivityUnix: Math.floor(Date.parse(currentNowIso) / 1000) - 1,
						})),
				}),
				ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
				clock: Clock.of({ nowIso: Effect.sync(() => currentNowIso) }),
			});
		await tick();
		expect(sends).toEqual([]);
		expect(await run(registry.pendingNudgeSince)).toBe(baseIso);
		currentNowIso = new Date((baseUnix + 61) * 1000).toISOString();
		await tick();
		expect(sends).toHaveLength(1);
		expect(sends[0]).toBe(`${PANDORA_TARGET}:<pithos-event>escalation-ready</pithos-event>`);
		expect(await run(registry.pendingNudgeSince)).toBeNull();
	});

	it("clears pendingNudgeSince and skips send when claimable count drops to zero", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const sends: string[] = [];
		const nowIso = "2026-05-09T00:00:31.000Z";
		const nowUnix = Math.floor(Date.parse(nowIso) / 1000);
		let ready: readonly ReadyTaskInput[] = [{ scope_id: "global", capability: "escalate" }];
		const config = await parseConfig(dataDir);
		const tick = () =>
			runTick({
				config,
				registry,
				pithos: makePithos([], () => ready),
				tmux: fakeTmux({
					sendLiteralLine: (target, text) => Effect.sync(() => sends.push(`${target}:${text}`)),
					presence: () => Effect.succeed({ attached: 1, lastActivityUnix: nowUnix - 1 }),
				}),
				ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
				clock: Clock.of({ nowIso: Effect.succeed(nowIso) }),
			});
		await tick();
		expect(sends).toEqual([]);
		expect(await run(registry.pendingNudgeSince)).toBe(nowIso);
		ready = [];
		await tick();
		expect(sends).toEqual([]);
		expect(await run(registry.pendingNudgeSince)).toBeNull();
	});

	it("normalises client_activity microseconds to correct unix seconds for presence detection", async () => {
		const nowMs = Date.parse("2026-05-09T00:00:31.000Z");
		const activityMicros = nowMs * 1000 - 2_000_000; // 2 seconds before now, microseconds format
		const processService = fakeProcess({
			execFile: (_file, args) => {
				if (args[0] === "display-message") {
					return Effect.succeed({ exitCode: 0, stdout: "1\n", stderr: "" });
				}
				if (args[0] === "list-clients") {
					return Effect.succeed({ exitCode: 0, stdout: `${activityMicros}\n`, stderr: "" });
				}
				return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
			},
		});
		const tmux = await run(makeTmux.pipe(Effect.provideService(Process, processService)));
		const presence = await run(tmux.presence("pdx--pandora"));
		expect(presence.attached).toBe(1);
		expect(presence.lastActivityUnix).toBe(Math.floor(nowMs / 1000) - 2);
	});

	it("Pandora template documents nudge marker recognition", async () => {
		const template = await readFile(
			new URL("../../../resources/data-dir/templates/agents/pandora.md", import.meta.url),
			"utf8",
		);
		expect(template).toContain("<pithos-event>escalation-ready</pithos-event>");
		expect(template).toContain("must not treat it as task content");
	});
});
