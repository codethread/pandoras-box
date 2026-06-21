import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { runTranscriptPdx } from "../src/controller.js";
import { makeSpawnerLive } from "../src/live.js";
import { PithosClient, Spawner } from "../src/services.js";
import { makePithos, makeSpawner, parseConfig, run, runOutput } from "./support.js";

describe("pdx run transcript", () => {
	it("delegates stored Pi session log lookup to spawner", async () => {
		const transcriptCalls: {
			harnessKind: "claude" | "pi" | "fagent";
			sessionLogPath: string;
			limit: number | undefined;
		}[] = [];
		const pithos = makePithos([], [], {
			runInspect: () =>
				Effect.succeed(
					runOutput({
						id: "run_pi",
						harness_kind: "pi",
						session_log_path: "/tmp/stored-session.jsonl",
					}),
				),
		});
		const spawner = makeSpawner({
			launchAgent: () => Effect.die("unexpected launch"),
			renderSessionTranscript: (input) =>
				Effect.sync(() => {
					transcriptCalls.push(input);
					return "resolved transcript\n";
				}),
		});

		await expect(
			run(
				runTranscriptPdx({ runId: "run_pi", limit: 7 }).pipe(
					Effect.provideService(PithosClient, pithos),
					Effect.provideService(Spawner, spawner),
				),
			),
		).resolves.toBe("resolved transcript\n");
		expect(transcriptCalls).toEqual([
			{ harnessKind: "pi", sessionLogPath: "/tmp/stored-session.jsonl", limit: 7 },
		]);
	});

	it("live spawner service resolves timestamp-prefixed Pi transcript siblings", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-transcript-live-"));
		const config = await parseConfig(dataDir);
		const spawner = makeSpawnerLive(config);
		const sessionId = "123e4567-e89b-12d3-a456-426614174000";
		const sessionDir = join(dataDir, "pi-sessions");
		const storedPath = join(sessionDir, `${sessionId}.jsonl`);
		const prefixedPath = join(sessionDir, `2026-06-17T14-20-13-511Z_${sessionId}.jsonl`);
		await mkdir(sessionDir, { recursive: true });
		await writeFile(
			prefixedPath,
			`${JSON.stringify({ type: "message", timestamp: "2026-05-10T12:00:00Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "Recovered live transcript" }] } })}\n`,
			"utf8",
		);

		await expect(
			run(
				spawner.renderSessionTranscript({
					harnessKind: "pi",
					sessionLogPath: storedPath,
					limit: undefined,
				}),
			),
		).resolves.toContain("[2026-05-10 12:00:00] ASSISTANT: Recovered live transcript");
	});
});
