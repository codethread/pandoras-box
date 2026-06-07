import { describe, expect, it } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PdxError } from "../src/errors.js";
import { listenIntakeSocket, parseIntakeEvent, requestIntake } from "../src/intake-socket.js";
import type { PithosClientService } from "../src/services.js";

const run = Effect.runPromise;

const makePithos = (calls: string[]): PithosClientService => ({
	init: () => Effect.die("unexpected init"),
	scopeUpsert: () => Effect.die("unexpected scopeUpsert"),
	runUpsert: () => Effect.die("unexpected runUpsert"),
	runCleanup: () => Effect.die("unexpected runCleanup"),
	runInterrupt: () => Effect.die("unexpected runInterrupt"),
	runTimeout: () => Effect.die("unexpected runTimeout"),
	runLaunchAbort: () => Effect.die("unexpected runLaunchAbort"),
	runInspect: () => Effect.die("unexpected runInspect"),
	activeRunForTask: () => Effect.die("unexpected activeRunForTask"),
	taskInspect: () => Effect.die("unexpected taskInspect"),
	taskHeartbeat: () => Effect.die("unexpected taskHeartbeat"),
	taskEnqueue: (input) =>
		Effect.sync(() => {
			calls.push(
				`taskEnqueue:${input.scope}:${input.capability}:${input.title}:${input.body}:${input.runId ?? ""}`,
			);
		}),
	escalateLaunchPrecondition: () => Effect.die("unexpected escalateLaunchPrecondition"),
	createRepairAlert: () => Effect.die("unexpected createRepairAlert"),
	claimableRepairAlertKinds: () => Effect.die("unexpected claimableRepairAlertKinds"),
	briefing: () => Effect.die("unexpected briefing"),
	pruneEvents: () => Effect.die("unexpected pruneEvents"),
});

describe("intake socket", () => {
	it("parses required non-empty title and body", async () => {
		await expect(run(parseIntakeEvent('{"title":"hello","body":"world"}'))).resolves.toEqual({
			title: "hello",
			body: "world",
		});
		await expect(run(parseIntakeEvent('{"title":"","body":"world"}'))).rejects.toThrow(
			"Invalid intake event",
		);
	});

	it("enqueues one global intake task from a submitted JSON event", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pdx-intake-"));
		const socketPath = join(dir, "intake.sock");
		const calls: string[] = [];
		const handle = await run(listenIntakeSocket(socketPath, makePithos(calls)));
		try {
			const response = await run(
				requestIntake(socketPath, '{"title":"first","body":"body one"}\n'),
			);
			expect(response).toEqual({ ok: true, data: { enqueued: 1 } });
			expect(calls).toEqual(["taskEnqueue:global:intake:first:body one:run_pdx_system"]);
		} finally {
			await run(handle.close);
		}
	});

	it("returns an error response for malformed intake input", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pdx-intake-"));
		const socketPath = join(dir, "intake.sock");
		const calls: string[] = [];
		const handle = await run(listenIntakeSocket(socketPath, makePithos(calls)));
		try {
			const response = await run(requestIntake(socketPath, '{"title":"missing body"}\n'));
			expect(response.ok).toBe(false);
			expect(response.error).toContain("Invalid intake event");
			expect(calls).toEqual([]);
		} finally {
			await run(handle.close);
		}
	});

	it("unlinks the socket on close", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pdx-intake-"));
		const socketPath = join(dir, "intake.sock");
		const handle = await run(listenIntakeSocket(socketPath, makePithos([])));
		await expect(stat(socketPath)).resolves.toBeDefined();
		await run(handle.close);
		await expect(stat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("returns an error response when enqueue fails", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pdx-intake-"));
		const socketPath = join(dir, "intake.sock");
		const pithos = {
			...makePithos([]),
			taskEnqueue: () =>
				Effect.fail(new PdxError({ code: "INTERNAL_ERROR", message: "database unavailable" })),
		};
		const handle = await run(listenIntakeSocket(socketPath, pithos));
		try {
			const response = await run(requestIntake(socketPath, '{"title":"t","body":"b"}\n'));
			expect(response).toEqual({ ok: false, error: "INTERNAL_ERROR: database unavailable" });
		} finally {
			await run(handle.close);
		}
	});
});
