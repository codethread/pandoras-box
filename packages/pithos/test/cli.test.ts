import Database from "better-sqlite3";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PithosError, runPithosCli, type PithosHelpCommand, type Services } from "../src/index.js";

const tempDb = () => join(mkdtempSync(join(tmpdir(), "pithos-cli-")), "pithos.db");

let idCounter = 0;

const services = (
	stdin:
		| { readonly _tag: "NoRedirectedStdin" }
		| { readonly _tag: "RedirectedText"; readonly text: string }
		| { readonly _tag: "ReadFailure"; readonly error: PithosError } = { _tag: "NoRedirectedStdin" },
	options: { readonly isTty?: boolean } = {},
): Services & { stdout: string[]; stderr: string[]; stdinReads: () => number } => {
	const stdout: string[] = [];
	const stderr: string[] = [];
	let stdinReadCount = 0;

	return {
		stdout,
		stderr,
		stdinReads: () => stdinReadCount,
		fs: {
			readText: () => Effect.succeed("body"),
			removeFile: (path) => Effect.sync(() => rmSync(path, { force: true })),
			existsDirectory: () => Effect.succeed(true),
		},
		input: {
			readStdin: () =>
				Effect.sync(() => {
					stdinReadCount += 1;
					return stdin;
				}),
		},
		output: {
			write: (text) => Effect.sync(() => void stdout.push(text)),
			writeError: (text) => Effect.sync(() => void stderr.push(text)),
			isTty: () => options.isTty ?? false,
		},
		ids: { make: (prefix) => Effect.sync(() => `${prefix}_cli_${idCounter++}`) },
		clock: { nowIso: () => Effect.succeed("2026-05-08T00:00:00.000Z") },
	};
};

const runCli = async (
	args: readonly string[],
	dbPath: string,
	stdin?: Parameters<typeof services>[0],
	options?: Parameters<typeof services>[1] & { readonly runId?: string },
) => {
	process.exitCode = undefined;
	const svc = services(stdin, options);
	let configRead = false;
	await Effect.runPromise(
		runPithosCli(
			{
				config: () => {
					configRead = true;
					return { dbPath, runId: options?.runId };
				},
				services: svc,
			},
			["node", "pithos", ...args],
		),
	);
	return { ...svc, configRead, exitCode: process.exitCode };
};

const upsertRun = (dbPath: string, runId: string, agent = "toil") =>
	runCli(
		[
			"run",
			"upsert",
			"--agent",
			agent,
			"--mode",
			agent === "pandora" ? "hitl" : "afk",
			"--scope",
			"global",
			"--cwd",
			"/tmp",
			"--session-id",
			`session_${runId}`,
			"--harness-kind",
			"pi",
			"--session-log-path",
			`/tmp/session_${runId}.jsonl`,
			"--run",
			runId,
		],
		dbPath,
	);

const upsertRepoWarRun = (dbPath: string) =>
	runCli(
		[
			"run",
			"upsert",
			"--agent",
			"war",
			"--mode",
			"afk",
			"--scope",
			"repo:/tmp/pithos-cli",
			"--cwd",
			"/tmp/pithos-cli",
			"--session-id",
			"session_run_war",
			"--harness-kind",
			"pi",
			"--session-log-path",
			"/tmp/session_run_war.jsonl",
			"--run",
			"run_war",
		],
		dbPath,
	);

const enqueueGlobalTriage = async (dbPath: string, runId: string, title: string, body: string) => {
	const result = await runCli(
		[
			"task",
			"enqueue",
			"--scope",
			"global",
			"--capability",
			"triage",
			"--title",
			title,
			"--stdin",
			"--run",
			runId,
		],
		dbPath,
		{ _tag: "RedirectedText", text: body },
	);
	return (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id;
};

const taskDependencies = (dbPath: string, taskId: string): readonly string[] => {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare(
				"SELECT target_task_id FROM task_edges WHERE task_id = ? AND kind = 'after' ORDER BY target_task_id ASC",
			)
			.pluck()
			.all(taskId) as string[];
	} finally {
		db.close();
	}
};

const taskCreatedPayload = (dbPath: string, taskId: string) => {
	const db = new Database(dbPath, { readonly: true });
	try {
		return JSON.parse(
			db
				.prepare("SELECT payload_json FROM events WHERE type = 'task.created' AND task_id = ?")
				.pluck()
				.get(taskId) as string,
		) as unknown;
	} finally {
		db.close();
	}
};

const taskBody = (dbPath: string, taskId: string) => {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.prepare("SELECT body FROM tasks WHERE id = ?").pluck().get(taskId);
	} finally {
		db.close();
	}
};

const artifactBody = (dbPath: string, artifactId: string) => {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.prepare("SELECT body FROM artifacts WHERE id = ?").pluck().get(artifactId);
	} finally {
		db.close();
	}
};

const taskResultJson = (dbPath: string, taskId: string) => {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.prepare("SELECT result_json FROM tasks WHERE id = ?").pluck().get(taskId);
	} finally {
		db.close();
	}
};

const artifactAddArgs = (taskId = "task_missing", extra: readonly string[] = []) => [
	"task",
	"artifact",
	"add",
	taskId,
	"--token",
	"1",
	"--kind",
	"note",
	"--title",
	"evidence",
	...extra,
];

const addNoteArtifact = async (
	dbPath: string,
	taskId: string,
	title: string,
	body: string,
): Promise<string> => {
	const result = await runCli(
		[
			"task",
			"artifact",
			"add",
			taskId,
			"--token",
			"1",
			"--kind",
			"note",
			"--title",
			title,
			"--stdin",
			"--run",
			"run_toil",
		],
		dbPath,
		{ _tag: "RedirectedText", text: body },
	);
	return (JSON.parse(result.stdout[0] ?? "") as { artifact: { id: string } }).artifact.id;
};

const completeArgs = (taskId: string, extra: readonly string[] = []) => [
	"task",
	"complete",
	taskId,
	"--run",
	"run_war",
	"--token",
	"1",
	...extra,
];

const claimGlobal = async (dbPath: string, runId: string, capability: "triage" | "escalate") => {
	const result = await runCli(
		["task", "claim", "--run", runId, "--scope", "global", "--capability", capability],
		dbPath,
	);
	return JSON.parse(result.stdout[0] ?? "") as { task: { id: string; token: number } };
};

const setupReplayFixture = async (dbPath: string) => {
	await runCli(["init", "--fresh"], dbPath);
	await upsertRun(dbPath, "run_toil");
	await upsertRun(dbPath, "run_pandora", "pandora");
	const target = await enqueueGlobalTriage(dbPath, "run_toil", "broken target", "body");
	await claimGlobal(dbPath, "run_toil", "triage");
	await runCli(["run", "interrupt", "--run", "run_toil", "--reason", "agent failed"], dbPath);
	const alertClaim = await claimGlobal(dbPath, "run_pandora", "escalate");
	return { target, repairAlert: alertClaim.task.id, token: alertClaim.task.token };
};

const normalizeGeneratedIds = (text: string): string =>
	text.replaceAll(/task_cli_\d+/g, "task_cli_N").replaceAll(/artifact_cli_\d+/g, "artifact_cli_N");

afterEach(() => {
	process.exitCode = undefined;
});

describe("pithos cli", () => {
	it("dispatches nested scope/run/events commands with JSON output", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		const scope = await runCli(
			["scope", "upsert", "--kind", "repo", "--path", "/tmp/pithos-cli"],
			dbPath,
		);
		const scopeBody = JSON.parse(scope.stdout[0] ?? "") as { scope: { id: string } };
		expect(scopeBody.scope.id).toBe("repo:/tmp/pithos-cli");
		const listed = await runCli(["scope", "list"], dbPath);
		expect(JSON.parse(listed.stdout[0] ?? "")).toEqual({
			ok: true,
			scopes: [
				{
					id: "global",
					kind: "global",
					canonical_path: null,
					parent_repo_path: null,
					archived_at: null,
					description: null,
					task_count: 0,
					run_count: 0,
					path_missing: false,
				},
				{
					id: "repo:/tmp/pithos-cli",
					kind: "repo",
					canonical_path: "/tmp/pithos-cli",
					parent_repo_path: null,
					archived_at: null,
					description: null,
					task_count: 0,
					run_count: 0,
					path_missing: false,
				},
			],
		});

		const upsert = await runCli(
			[
				"run",
				"upsert",
				"--agent",
				"war",
				"--mode",
				"afk",
				"--scope",
				scopeBody.scope.id,
				"--cwd",
				"/tmp/pithos-cli",
				"--session-id",
				"session_cli",
				"--harness-kind",
				"pi",
				"--session-log-path",
				"/tmp/session_cli.jsonl",
				"--run",
				"run_cli",
			],
			dbPath,
		);
		expect(JSON.parse(upsert.stdout[0] ?? "")).toMatchObject({
			ok: true,
			run: {
				id: "run_cli",
				agent: "war",
				mode: "afk",
				status: "live",
				harness_kind: "pi",
				session_log_path: "/tmp/session_cli.jsonl",
			},
		});

		const inspect = await runCli(["run", "inspect", "run_cli"], dbPath);
		expect(JSON.parse(inspect.stdout[0] ?? "")).toMatchObject({
			ok: true,
			run: {
				id: "run_cli",
				session_id: "session_cli",
				harness_kind: "pi",
				session_log_path: "/tmp/session_cli.jsonl",
			},
		});

		const events = await runCli(["events", "tail", "--limit", "1"], dbPath);
		expect(JSON.parse(events.stdout[0] ?? "")).toEqual({ ok: true, events: [] });
	});

	it("archives unreferenced scopes by deleting them through the CLI", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await runCli(["scope", "upsert", "--kind", "repo", "--path", "/tmp/pithos-delete-cli"], dbPath);
		const archived = await runCli(["scope", "archive", "repo:/tmp/pithos-delete-cli"], dbPath);
		expect(JSON.parse(archived.stdout[0] ?? "")).toEqual({
			ok: true,
			action: "deleted",
			scope: {
				id: "repo:/tmp/pithos-delete-cli",
				kind: "repo",
				canonical_path: "/tmp/pithos-delete-cli",
				parent_repo_path: null,
				archived_at: null,
				description: null,
				task_count: 0,
				run_count: 0,
				path_missing: false,
			},
		});
		const listed = await runCli(["scope", "list"], dbPath);
		expect(JSON.parse(listed.stdout[0] ?? "")).toEqual({
			ok: true,
			scopes: [
				{
					id: "global",
					kind: "global",
					canonical_path: null,
					parent_repo_path: null,
					archived_at: null,
					description: null,
					task_count: 0,
					run_count: 0,
					path_missing: false,
				},
			],
		});
	});

	it("stores and surfaces scope description via --description flag", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		const scoped = await runCli(
			[
				"scope",
				"upsert",
				"--kind",
				"repo",
				"--path",
				"/tmp/pithos-desc-cli",
				"--description",
				"my repo description",
			],
			dbPath,
		);
		const scopeBody = JSON.parse(scoped.stdout[0] ?? "") as {
			scope: { description: string | null };
		};
		expect(scopeBody.scope.description).toBe("my repo description");
		const listed = await runCli(["scope", "list"], dbPath);
		const listBody = JSON.parse(listed.stdout[0] ?? "") as {
			scopes: { id: string; description: string | null }[];
		};
		expect(listBody.scopes.find((s) => s.id === "repo:/tmp/pithos-desc-cli")?.description).toBe(
			"my repo description",
		);
		// Re-upsert without --description preserves the existing description
		const reupserted = await runCli(
			["scope", "upsert", "--kind", "repo", "--path", "/tmp/pithos-desc-cli"],
			dbPath,
		);
		const reBody = JSON.parse(reupserted.stdout[0] ?? "") as {
			scope: { description: string | null };
		};
		expect(reBody.scope.description).toBe("my repo description");
	});

	it("sets path_missing for repo/worktree scopes whose canonical_path no longer exists", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await runCli(
			["scope", "upsert", "--kind", "repo", "--path", "/tmp/pithos-stale-path-cli"],
			dbPath,
		);

		// List with the registered directory now missing from disk
		const stdout: string[] = [];
		const svc = services();
		process.exitCode = undefined;
		await Effect.runPromise(
			runPithosCli(
				{
					config: () => ({ dbPath }),
					services: {
						...svc,
						fs: {
							readText: () => Effect.succeed("body"),
							removeFile: (path) => Effect.sync(() => rmSync(path, { force: true })),
							existsDirectory: (path) => Effect.succeed(path !== "/tmp/pithos-stale-path-cli"),
						},
						output: {
							write: (text) => Effect.sync(() => void stdout.push(text)),
							writeError: () => Effect.sync(() => void 0),
							isTty: () => false,
						},
					},
				},
				["node", "pithos", "scope", "list"],
			),
		);

		const body = JSON.parse(stdout[0] ?? "") as {
			scopes: { id: string; path_missing: boolean }[];
		};
		expect(body.scopes.find((s) => s.id === "global")?.path_missing).toBe(false);
		expect(body.scopes.find((s) => s.id === "repo:/tmp/pithos-stale-path-cli")?.path_missing).toBe(
			true,
		);
	});

	it("lists archived scopes only with --all through the CLI", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		await runCli(
			["scope", "upsert", "--kind", "repo", "--path", "/tmp/pithos-archive-cli"],
			dbPath,
		);
		const taskId = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"repo:/tmp/pithos-archive-cli",
				"--capability",
				"execute",
				"--title",
				"archive me",
				"--stdin",
				"--run",
				"run_toil",
			],
			dbPath,
			{ _tag: "RedirectedText", text: "body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);
		await runCli(["task", "cancel", taskId, "--run", "run_toil", "--reason", "done"], dbPath);
		const archived = await runCli(["scope", "archive", "repo:/tmp/pithos-archive-cli"], dbPath);
		const archivedBody = JSON.parse(archived.stdout[0] ?? "") as {
			ok: true;
			action: string;
			scope: { id: string; archived_at: string | null };
		};
		expect(archivedBody.ok).toBe(true);
		expect(archivedBody.action).toBe("archived");
		expect(archivedBody.scope.id).toBe("repo:/tmp/pithos-archive-cli");
		expect(archivedBody.scope.archived_at).toEqual(expect.any(String));
		const activeOnly = await runCli(["scope", "list"], dbPath);
		expect(
			(JSON.parse(activeOnly.stdout[0] ?? "") as { scopes: { id: string }[] }).scopes.map(
				(scope) => scope.id,
			),
		).toEqual(["global"]);
		const allScopes = await runCli(["scope", "list", "--all"], dbPath);
		const archivedScope = (
			JSON.parse(allScopes.stdout[0] ?? "") as {
				scopes: { id: string; archived_at: string | null }[];
			}
		).scopes.find((scope) => scope.id === "repo:/tmp/pithos-archive-cli");
		expect(archivedScope).toBeDefined();
		expect(archivedScope?.archived_at).toEqual(expect.any(String));
	});

	it("defers run agent validation to Pithos and renders PithosError JSON", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		const result = await runCli(
			[
				"run",
				"upsert",
				"--agent",
				"unknown",
				"--mode",
				"afk",
				"--scope",
				"global",
				"--cwd",
				"/tmp",
				"--session-id",
				"session",
				"--harness-kind",
				"claude",
				"--session-log-path",
				"/tmp/session.jsonl",
			],
			dbPath,
		);
		const errors: unknown[] = result.stderr.map((line) => JSON.parse(line) as unknown);
		expect(errors).toEqual([
			{
				ok: false,
				error: { code: "VALIDATION_ERROR", message: "unknown agent kind: unknown" },
			},
		]);
		expect(result.exitCode).toBe(2);
	});

	it("renders PithosError failures as JSON", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		const result = await runCli(
			[
				"run",
				"upsert",
				"--agent",
				"war",
				"--mode",
				"afk",
				"--scope",
				"repo:/missing",
				"--cwd",
				"/tmp",
				"--session-id",
				"session",
				"--harness-kind",
				"claude",
				"--session-log-path",
				"/tmp/session.jsonl",
			],
			dbPath,
		);
		const errors: unknown[] = result.stderr.map((line) => JSON.parse(line) as unknown);
		expect(errors).toEqual([
			{
				ok: false,
				error: { code: "NOT_FOUND", message: "scope not found: repo:/missing" },
			},
		]);
		expect(result.exitCode).toBe(3);
	});

	it("enqueues multiline task bodies from explicit stdin", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_pandora", "pandora");
		const taskId = await enqueueGlobalTriage(
			dbPath,
			"run_pandora",
			"stdin task",
			"line 1\nline 2\n",
		);

		const inspect = await runCli(["task", "inspect", taskId, "--json"], dbPath);
		const inspected = JSON.parse(inspect.stdout[0] ?? "") as {
			readonly ok: true;
			readonly dependencies: readonly unknown[];
			readonly lineage: readonly unknown[];
			readonly task: { readonly title: string; readonly body: string };
		};
		expect(inspected).toMatchObject({ ok: true, dependencies: [], lineage: [] });
		expect(inspected.task.title).toBe("stdin task");
		expect(inspected.task.body).toBe("line 1\nline 2\n");
		expect(taskBody(dbPath, taskId)).toBe("line 1\nline 2\n");
	});

	it("renders task inspect as a single-task markdown dossier by default", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const origin = await enqueueGlobalTriage(dbPath, "run_toil", "Original request", "origin body");
		const ancestor = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Ancestor decision",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				origin,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "ancestor body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);
		const parent = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Parent plan",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				ancestor,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "parent body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);
		const current = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Current handoff",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				parent,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "current body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);
		await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Dependent follow-up",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				current,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "dependent body" },
		);

		const inspect = await runCli(["task", "inspect", current], dbPath);
		const output = inspect.stdout[0] ?? "";

		expect(output.startsWith(`# ${current} [triage] [queued] Current handoff\n`)).toBe(true);
		expect(() => {
			JSON.parse(output) as unknown;
		}).toThrow();
		expect(output).not.toContain(`### ${origin} [triage] [queued] Original request`);
		expect(normalizeGeneratedIds(output)).toMatchInlineSnapshot(`
			"# task_cli_N [triage] [queued] Current handoff

			Body:

			\`\`\`md
			current body
			\`\`\`

			Direct after dependencies:

			- task_cli_N [triage] [queued] Parent plan

			Direct after dependents:

			- task_cli_N [triage] [queued] Dependent follow-up

			Coordination gates:

			- none

			Attached context:

			- none
			"
		`);
	});

	it("snapshots task inspect markdown for single-task drill-down", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const origin = await enqueueGlobalTriage(dbPath, "run_toil", "Original request", "origin body");
		const triage = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Triage plan",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				origin,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "triage body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);
		const design = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Design output mode",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				triage,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "design body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);
		const execute = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Execute renderer",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				design,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "execute body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);
		const followUp = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Follow-up verification",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				execute,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "follow-up body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);

		const inspect = await runCli(["task", "inspect", followUp], dbPath);
		expect(inspect.stdout[0]).not.toContain("Original request");
		expect(inspect.stdout[0]).not.toContain("Triage plan");
		expect(normalizeGeneratedIds(inspect.stdout[0] ?? "")).toMatchInlineSnapshot(`
			"# task_cli_N [triage] [queued] Follow-up verification

			Body:

			\`\`\`md
			follow-up body
			\`\`\`

			Direct after dependencies:

			- task_cli_N [triage] [queued] Execute renderer

			Direct after dependents:

			- none

			Coordination gates:

			- none

			Attached context:

			- none
			"
		`);
	});

	it("snapshots readable graph inspect for a nested forked chain", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await runCli(["scope", "upsert", "--kind", "repo", "--path", "/tmp/pithos-cli"], dbPath);
		await runCli(
			[
				"run",
				"upsert",
				"--agent",
				"toil",
				"--mode",
				"afk",
				"--scope",
				"repo:/tmp/pithos-cli",
				"--cwd",
				"/tmp/pithos-cli",
				"--session-id",
				"session_run_toil_repo",
				"--harness-kind",
				"pi",
				"--session-log-path",
				"/tmp/session_run_toil_repo.jsonl",
				"--run",
				"run_toil_repo",
			],
			dbPath,
		);
		const enqueue = async (
			title: string,
			capability: "triage" | "design" | "execute",
			after: readonly string[] = [],
		): Promise<string> =>
			runCli(
				[
					"task",
					"enqueue",
					"--scope",
					"repo:/tmp/pithos-cli",
					"--capability",
					capability,
					"--title",
					title,
					"--stdin",
					"--run",
					"run_toil_repo",
					"--chain",
					"none",
					...after.flatMap((id) => ["--after", id]),
				],
				dbPath,
				{ _tag: "RedirectedText", text: `${title} body` },
			).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);

		const triage = await enqueue("Triage readable inspect API", "triage");
		const design = await enqueue("Design output mode contract", "design", [triage]);
		const executeA = await enqueue("Execute A task inspect renderer", "execute", [design]);
		const executeB = await enqueue("Execute B graph briefing help", "execute", [design]);
		await enqueue("Follow-up A docs for inspect", "execute", [executeA]);
		await enqueue("Follow-up B prompt verification", "execute", [executeB]);

		const graphText = await runCli(["graph", "inspect", "--scope", "repo:/tmp/pithos-cli"], dbPath);
		expect(normalizeGeneratedIds(graphText.stdout[0] ?? "")).toMatchInlineSnapshot(`
			"# Task graph map
			selector: scope repo:/tmp/pithos-cli
			edges: owner/follow-up --kind--> referenced task
			layout: referenced task, then incoming owners
			legend: ↑ already shown · ↻ supersession history

			- task_cli_N [triage] [queued] Triage readable inspect API
			  scope: repo:/tmp/pithos-cli
			  preview: Triage readable inspect API
			  - after ← task_cli_N [design] [queued] Design output mode contract
			    scope: repo:/tmp/pithos-cli
			    preview: Design output mode contract
			    - after ← task_cli_N [execute] [queued] Execute A task inspect renderer
			      scope: repo:/tmp/pithos-cli
			      preview: Execute A task inspect renderer
			      - after ← task_cli_N [execute] [queued] Follow-up A docs for inspect
			        scope: repo:/tmp/pithos-cli
			        preview: Follow-up A docs for inspect
			    - after ← task_cli_N [execute] [queued] Execute B graph briefing help
			      scope: repo:/tmp/pithos-cli
			      preview: Execute B graph briefing help
			      - after ← task_cli_N [execute] [queued] Follow-up B prompt verification
			        scope: repo:/tmp/pithos-cli
			        preview: Follow-up B prompt verification
			"
		`);
	});

	it("renders graph inspect and briefing as readable text by default with --json escape hatch", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const ready = await enqueueGlobalTriage(dbPath, "run_toil", "Ready triage", "ready body");
		const blocked = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"Blocked triage",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				ready,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "blocked body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);

		const graphText = await runCli(["graph", "inspect", "--all"], dbPath);
		expect(() => {
			JSON.parse(graphText.stdout[0] ?? "") as unknown;
		}).toThrow();
		expect(normalizeGeneratedIds(graphText.stdout[0] ?? "")).toMatchInlineSnapshot(`
			"# Task graph map
			selector: all
			edges: owner/follow-up --kind--> referenced task
			layout: referenced task, then incoming owners
			legend: ↑ already shown · ↻ supersession history

			- task_cli_N [triage] [queued] Ready triage
			  scope: global
			  preview: Ready triage
			  - after ← task_cli_N [triage] [queued] Blocked triage
			    scope: global
			    preview: Blocked triage
			"
		`);

		const graphJson = await runCli(["graph", "inspect", "--all", "--json"], dbPath);
		expect(JSON.parse(graphJson.stdout[0] ?? "")).toMatchObject({
			ok: true,
			graph: {
				selector: { kind: "all" },
				nodes: [expect.objectContaining({ id: ready }), expect.objectContaining({ id: blocked })],
			},
		});

		const filteredGraphJson = await runCli(
			["graph", "inspect", "--all", "--status", "queued", "--json"],
			dbPath,
		);
		expect(JSON.parse(filteredGraphJson.stdout[0] ?? "")).toMatchObject({
			ok: true,
			graph: {
				selector: { kind: "all" },
				nodes: [expect.objectContaining({ id: ready }), expect.objectContaining({ id: blocked })],
			},
		});

		const stale = await enqueueGlobalTriage(dbPath, "run_toil", "Stale triage", "stale body");
		const db = new Database(dbPath);
		try {
			db.prepare("UPDATE tasks SET created_at=?, updated_at=? WHERE id=?").run(
				"2026-05-06 00:00:00",
				"2026-05-06 00:00:00",
				ready,
			);
			db.prepare("UPDATE tasks SET created_at=?, updated_at=? WHERE id=?").run(
				"2026-05-07 01:00:00",
				"2026-05-07 01:00:00",
				blocked,
			);
			db.prepare(
				"UPDATE tasks SET status='cancelled', created_at=?, updated_at=?, completed_at=? WHERE id=?",
			).run("2026-05-06 00:00:00", "2026-05-06 00:00:00", "2026-05-06 00:00:00", stale);
		} finally {
			db.close();
		}
		const sinceGraphJson = await runCli(
			["graph", "inspect", "--all", "--since", "24h", "--json"],
			dbPath,
		);
		const sinceNodeIds = (
			JSON.parse(sinceGraphJson.stdout[0] ?? "") as { graph: { nodes: { id: string }[] } }
		).graph.nodes.map((node) => node.id);
		expect(sinceNodeIds.sort()).toEqual([ready, blocked].sort());

		const briefingText = await runCli(["briefing", "--agent", "toil"], dbPath);
		expect(normalizeGeneratedIds(briefingText.stdout[0] ?? "")).toMatchInlineSnapshot(`
			"# Briefing

			## Ready
			- task_cli_N [triage] [queued] Ready triage

			## Blocked
			- task_cli_N [triage] [queued] Blocked triage
			  - after blocker task_cli_N [queued] scope=global

			## Recently Completed
			- none
			"
		`);

		const briefingJson = await runCli(["briefing", "--agent", "toil", "--json"], dbPath);
		expect(JSON.parse(briefingJson.stdout[0] ?? "")).toMatchObject({
			ok: true,
			ready: [expect.objectContaining({ id: ready })],
			blocked: [expect.objectContaining({ id: blocked, unresolved_dependency_ids: [ready] })],
		});
	});

	describe("graph inspect terminal rendering", () => {
		const claimGlobal = async (dbPath: string, runId: string) => {
			const result = await runCli(
				["task", "claim", "--run", runId, "--scope", "global", "--capability", "triage"],
				dbPath,
			);
			return JSON.parse(result.stdout[0] ?? "") as { task: { id: string; token: number } };
		};

		it("renders terminal nodes in readable output by default", async () => {
			const dbPath = tempDb();
			await runCli(["init", "--fresh"], dbPath);
			await upsertRun(dbPath, "run_toil");

			const doneLeaf = await enqueueGlobalTriage(dbPath, "run_toil", "Done leaf", "body");
			const doneClaim = await claimGlobal(dbPath, "run_toil");
			expect(doneClaim.task.id).toBe(doneLeaf);
			await runCli(
				[
					"task",
					"complete",
					"--run",
					"run_toil",
					"--token",
					String(doneClaim.task.token),
					doneLeaf,
				],
				dbPath,
			);

			const text = (await runCli(["graph", "inspect", "--task", doneLeaf], dbPath)).stdout[0] ?? "";
			expect(text).toContain(`- ${doneLeaf} [triage] [done] Done leaf`);

			const parsed = JSON.parse(
				(await runCli(["graph", "inspect", "--task", doneLeaf, "--json"], dbPath)).stdout[0] ?? "",
			) as { graph: { nodes: { id: string }[] } };
			expect(parsed.graph.nodes.map((node) => node.id)).toEqual([doneLeaf]);
		});

		it("adds ANSI colors to graph inspect in a tty", async () => {
			const dbPath = tempDb();
			await runCli(["init", "--fresh"], dbPath);
			await upsertRun(dbPath, "run_toil");

			const taskId = await enqueueGlobalTriage(dbPath, "run_toil", "Done leaf", "body");
			const claim = await claimGlobal(dbPath, "run_toil");
			expect(claim.task.id).toBe(taskId);
			await runCli(
				["task", "complete", "--run", "run_toil", "--token", String(claim.task.token), taskId],
				dbPath,
			);

			const text =
				(await runCli(["graph", "inspect", "--task", taskId], dbPath, undefined, { isTty: true }))
					.stdout[0] ?? "";
			expect(text).toContain(`- [32m${taskId}[0m [2m[36m[triage][0m [done] Done leaf`);
			expect(text).not.toContain(`[32m[done]`);
		});

		it("adds ANSI colors to task claim success and no-work failures in a tty", async () => {
			const dbPath = tempDb();
			await runCli(["init", "--fresh"], dbPath);
			await upsertRun(dbPath, "run_toil");
			await upsertRun(dbPath, "run_other");
			await enqueueGlobalTriage(dbPath, "run_toil", "Claim me", "body");

			const claimed = await runCli(
				["task", "claim", "--run", "run_toil", "--scope", "global", "--capability", "triage"],
				dbPath,
				undefined,
				{ isTty: true },
			);
			expect(claimed.stdout[0]).toContain('"status":"[32mclaimed[0m"');
			expect(claimed.stdout[0]).toContain('"ok":true');
			expect(claimed.stdout[0]).not.toContain('[32m{"ok":true');

			const noWork = await runCli(
				["task", "claim", "--run", "run_other", "--scope", "global", "--capability", "triage"],
				dbPath,
				undefined,
				{ isTty: true },
			);
			expect(noWork.stderr[0]).toContain("\u001b[2m\u001b[33m");
			expect(noWork.stderr[0]).toContain('"code":"NO_CLAIMABLE_WORK"');
			expect(noWork.exitCode).toBe(5);
		});

		it("rejects the removed --hide-terminal flag", async () => {
			const dbPath = tempDb();
			await runCli(["init", "--fresh"], dbPath);
			await expect(
				runCli(["graph", "inspect", "--all", "--hide-terminal"], dbPath),
			).rejects.toThrow("hide-terminal");
		});

		it("rejects invalid graph status filters with tagged validation", async () => {
			const dbPath = tempDb();
			const result = await runCli(["graph", "inspect", "--all", "--status", "active"], dbPath);

			expect(result.stdout).toEqual([]);
			expect(result.configRead).toBe(false);
			expect(result.stderr.map((line) => JSON.parse(line) as unknown)).toEqual([
				{
					ok: false,
					error: {
						code: "VALIDATION_ERROR",
						message:
							"Invalid --status value: 'active'. Valid values: queued, claimed, running, done, failed, dead_letter, cancelled",
					},
				},
			]);
			expect(result.exitCode).toBe(2);
		});

		it("rejects empty graph search filters with tagged validation", async () => {
			const dbPath = tempDb();
			const result = await runCli(["graph", "inspect", "--all", "--search", ""], dbPath);

			expect(result.stdout).toEqual([]);
			expect(result.configRead).toBe(false);
			expect(result.stderr.map((line) => JSON.parse(line) as unknown)).toEqual([
				{
					ok: false,
					error: {
						code: "VALIDATION_ERROR",
						message: "--search must be non-empty",
					},
				},
			]);
			expect(result.exitCode).toBe(2);
		});

		it("rejects invalid graph since filters with tagged validation", async () => {
			const dbPath = tempDb();
			await runCli(["init", "--fresh"], dbPath);
			const result = await runCli(["graph", "inspect", "--all", "--since", "yesterday"], dbPath);

			expect(result.stdout).toEqual([]);
			expect(result.stderr.map((line) => JSON.parse(line) as unknown)).toEqual([
				{
					ok: false,
					error: {
						code: "VALIDATION_ERROR",
						message: "invalid --since cutoff",
					},
				},
			]);
			expect(result.exitCode).toBe(2);
		});

		it("preserves tagged selector validation failures", async () => {
			const dbPath = tempDb();
			await runCli(["init", "--fresh"], dbPath);

			for (const args of [
				["graph", "inspect"],
				["graph", "inspect", "--all", "--scope", "global"],
			]) {
				const result = await runCli(args, dbPath);
				expect(result.stdout).toEqual([]);
				expect(result.stderr.map((line) => JSON.parse(line) as unknown)).toEqual([
					{
						ok: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "provide exactly one graph selector",
						},
					},
				]);
				expect(result.exitCode).toBe(2);
			}
		});
	});

	it("replays a broken target through a held Pandora Repair Alert", async () => {
		const dbPath = tempDb();
		const { target, repairAlert, token } = await setupReplayFixture(dbPath);

		const result = await runCli(
			[
				"task",
				"replay",
				target,
				"--run",
				"run_pandora",
				"--token",
				String(token),
				"--reason",
				"VPN restored",
			],
			dbPath,
		);

		expect(JSON.parse(result.stdout[0] ?? "")).toEqual({
			ok: true,
			task: { id: target, status: "queued" },
			repair_alert: { id: repairAlert, status: "done" },
		});
		expect(result.stdinReads()).toBe(0);
		const inspect = await runCli(["task", "inspect", target, "--json"], dbPath);
		expect(JSON.parse(inspect.stdout[0] ?? "")).toMatchObject({
			ok: true,
			task: { id: target, status: "queued", attempts: 0 },
		});
	});

	it("uses PITHOS_RUN_ID for task replay and rejects conflicting --run", async () => {
		const dbPath = tempDb();
		const { target, token } = await setupReplayFixture(dbPath);

		const conflict = await runCli(
			[
				"task",
				"replay",
				target,
				"--run",
				"run_other",
				"--token",
				String(token),
				"--reason",
				"fixed",
			],
			dbPath,
			undefined,
			{ runId: "run_pandora" },
		);
		expect(JSON.parse(conflict.stderr[0] ?? "")).toEqual({
			ok: false,
			error: { code: "VALIDATION_ERROR", message: "--run conflicts with PITHOS_RUN_ID" },
		});

		const replayed = await runCli(
			["task", "replay", target, "--token", String(token), "--reason", "fixed"],
			dbPath,
			undefined,
			{ runId: "run_pandora" },
		);
		expect(JSON.parse(replayed.stdout[0] ?? "")).toMatchObject({
			ok: true,
			task: { id: target, status: "queued" },
		});
	});

	it("returns tagged JSON for task replay validation failures", async () => {
		const missingReason = await runCli(
			["task", "replay", "task_missing", "--token", "1"],
			tempDb(),
		);
		expect(JSON.parse(missingReason.stderr[0] ?? "")).toEqual({
			ok: false,
			error: { code: "VALIDATION_ERROR", message: "missing --reason" },
		});
		expect(missingReason.configRead).toBe(false);

		for (const args of [
			["task", "replay", "task_missing", "--token", "1", "--reason", ""],
			["task", "replay", "task_missing", "--token", "1", "--reason"],
		]) {
			const emptyReason = await runCli(args, tempDb());
			expect(JSON.parse(emptyReason.stderr[0] ?? "")).toEqual({
				ok: false,
				error: { code: "VALIDATION_ERROR", message: "--reason must be non-empty" },
			});
			expect(emptyReason.configRead).toBe(false);
		}

		const dbPath = tempDb();
		const { target, token } = await setupReplayFixture(dbPath);
		const stale = await runCli(
			[
				"task",
				"replay",
				target,
				"--run",
				"run_pandora",
				"--token",
				String(token + 1),
				"--reason",
				"fixed",
			],
			dbPath,
		);
		expect(JSON.parse(stale.stderr[0] ?? "")).toEqual({
			ok: false,
			error: {
				code: "STALE_TOKEN",
				message: "repair alert token is stale or task is not held by run",
			},
		});

		await upsertRun(dbPath, "run_toil_other");
		const otherTarget = await enqueueGlobalTriage(dbPath, "run_toil_other", "other broken", "body");
		const mismatch = await runCli(
			[
				"task",
				"replay",
				otherTarget,
				"--run",
				"run_pandora",
				"--token",
				String(token),
				"--reason",
				"fixed",
			],
			dbPath,
		);
		expect(JSON.parse(mismatch.stderr[0] ?? "")).toEqual({
			ok: false,
			error: {
				code: "VALIDATION_ERROR",
				message: "held Repair Alert does not repair the target task",
			},
		});
	});

	it("renders task replay help and includes help JSON metadata", async () => {
		const commandHelp = await runCli(["task", "replay", "--help"], tempDb());
		expect(commandHelp.configRead).toBe(false);
		expect(commandHelp.stderr).toEqual([]);

		const result = await runCli(["--help-json"], tempDb());
		const help = JSON.parse(result.stdout[0] ?? "") as PithosHelpCommand;
		const flatten = (command: PithosHelpCommand): readonly PithosHelpCommand[] => [
			command,
			...command.subcommands.flatMap(flatten),
		];
		const replay = flatten(help).find((command) => command.path === "pithos task replay");
		expect(replay).toMatchObject({
			path: "pithos task replay",
			description:
				"Replay a broken target task through the held Pandora Repair Alert and complete that alert.",
		});
		expect(replay?.usage).toContain("--token");
		expect(replay?.usage).toContain("--reason");
	});

	it("supersedes with explicit stdin replacement body", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const originalTaskId = await enqueueGlobalTriage(dbPath, "run_toil", "old task", "old body");

		const replacement = await runCli(
			[
				"task",
				"supersede",
				originalTaskId,
				"--reason",
				"replace body",
				"--title",
				"new task",
				"--stdin",
				"--run",
				"run_toil",
			],
			dbPath,
			{ _tag: "RedirectedText", text: "new body\n" },
		);
		const replacementTaskId = (JSON.parse(replacement.stdout[0] ?? "") as { task: { id: string } })
			.task.id;
		expect(taskBody(dbPath, replacementTaskId)).toBe("new body\n");
		expect(taskBody(dbPath, originalTaskId)).toBe("old body");
	});

	it("returns validation JSON when supersede omits --stdin", async () => {
		const result = await runCli(
			["task", "supersede", "task_missing", "--reason", "replace body"],
			tempDb(),
		);
		expect(JSON.parse(result.stderr[0] ?? "")).toMatchObject({
			ok: false,
			error: { code: "VALIDATION_ERROR" },
		});
		expect(result.exitCode).toBe(2);
		expect(result.configRead).toBe(false);
	});

	it("validates supersede stdin availability and non-empty content", async () => {
		for (const stdin of [
			{ _tag: "NoRedirectedStdin" as const },
			{ _tag: "RedirectedText" as const, text: "" },
		]) {
			const result = await runCli(
				["task", "supersede", "task_missing", "--reason", "replace body", "--stdin"],
				tempDb(),
				stdin,
			);
			expect(JSON.parse(result.stderr[0] ?? "")).toMatchObject({
				ok: false,
				error: { code: "VALIDATION_ERROR" },
			});
			expect(result.exitCode).toBe(2);
			expect(result.configRead).toBe(false);
		}
	});

	it("returns parser errors for removed supersede body flags", async () => {
		for (const flag of ["--body", "--body-file"] as const) {
			await expect(
				runCli(
					["task", "supersede", "task_missing", "--reason", "replace body", flag, "payload"],
					tempDb(),
				),
			).rejects.toThrow(flag);
		}
	});

	it("adds artifact bodies from explicit stdin", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const taskId = await enqueueGlobalTriage(dbPath, "run_toil", "artifact task", "task body");

		const claim = await claimGlobal(dbPath, "run_toil", "triage");
		expect(claim.task.id).toBe(taskId);
		const result = await runCli(artifactAddArgs(taskId, ["--stdin", "--run", "run_toil"]), dbPath, {
			_tag: "RedirectedText",
			text: "artifact body\n",
		});
		const artifactId = (JSON.parse(result.stdout[0] ?? "") as { artifact: { id: string } }).artifact
			.id;
		expect(artifactBody(dbPath, artifactId)).toBe("artifact body\n");
	});

	it("adds empty artifact bodies when --stdin is omitted", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const taskId = await enqueueGlobalTriage(dbPath, "run_toil", "artifact task", "task body");

		const claim = await claimGlobal(dbPath, "run_toil", "triage");
		expect(claim.task.id).toBe(taskId);
		const result = await runCli(artifactAddArgs(taskId, ["--run", "run_toil"]), dbPath);
		const artifactId = (JSON.parse(result.stdout[0] ?? "") as { artifact: { id: string } }).artifact
			.id;
		expect(artifactBody(dbPath, artifactId)).toBe("");
	});

	it("rejects, lists, and shows artifacts through the CLI", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const taskId = await enqueueGlobalTriage(dbPath, "run_toil", "artifact task", "task body");
		await claimGlobal(dbPath, "run_toil", "triage");
		const added = await runCli(artifactAddArgs(taskId, ["--stdin", "--run", "run_toil"]), dbPath, {
			_tag: "RedirectedText",
			text: "artifact body\n",
		});
		const artifactId = (JSON.parse(added.stdout[0] ?? "") as { artifact: { id: string } }).artifact
			.id;

		const rejected = await runCli(
			[
				"task",
				"artifact",
				"reject",
				artifactId,
				"--run",
				"run_toil",
				"--token",
				"1",
				"--reason",
				"wrong artifact",
			],
			dbPath,
		);
		expect(JSON.parse(rejected.stdout[0] ?? "")).toMatchObject({
			ok: true,
			artifact: { id: artifactId, status: "rejected", rejection_reason: "wrong artifact" },
		});
		expect(rejected.stdout[0]).not.toContain("artifact body");

		const listJson = await runCli(["task", "artifact", "list", taskId, "--json"], dbPath);
		expect(JSON.parse(listJson.stdout[0] ?? "")).toMatchObject({
			ok: true,
			artifacts: [{ id: artifactId, status: "rejected", rejection_reason: "wrong artifact" }],
		});
		expect(listJson.stdout[0]).not.toContain("artifact body");
		const listText = await runCli(["task", "artifact", "list", taskId], dbPath);
		expect(listText.stdout[0]).toContain(`[rejected: wrong artifact]`);
		expect(listText.stdout[0]).not.toContain("artifact body");

		const showJson = await runCli(["task", "artifact", "show", artifactId, "--json"], dbPath);
		expect(JSON.parse(showJson.stdout[0] ?? "")).toMatchObject({
			ok: true,
			artifact: { id: artifactId, status: "rejected", body: "artifact body\n" },
		});
		const showText = await runCli(["task", "artifact", "show", artifactId], dbPath);
		expect(showText.stdout[0]).toContain("```json");
		expect(showText.stdout[0]).toContain("artifact body");
	});

	it("renders compact active artifact refs in task and graph inspect", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const taskId = await enqueueGlobalTriage(dbPath, "run_toil", "artifact task", "task body");
		await claimGlobal(dbPath, "run_toil", "triage");
		const rejectedId = await addNoteArtifact(dbPath, taskId, "old evidence", "rejected body\n");
		await runCli(
			[
				"task",
				"artifact",
				"reject",
				rejectedId,
				"--run",
				"run_toil",
				"--token",
				"1",
				"--reason",
				"wrong artifact",
			],
			dbPath,
		);
		const activeId = await addNoteArtifact(dbPath, taskId, "active evidence", "active body\n");

		const compact = (await runCli(["task", "inspect", taskId], dbPath)).stdout[0] ?? "";
		expect(compact).toContain(`- ${activeId} [note] active evidence`);
		expect(compact).not.toContain("active body");
		expect(compact).not.toContain(rejectedId);
		expect(compact).not.toContain("rejected body");

		const full = (await runCli(["task", "inspect", taskId, "--full"], dbPath)).stdout[0] ?? "";
		expect(full).toContain(`Artifact ${activeId} [note] active evidence:`);
		expect(full).toContain("active body");
		expect(full).not.toContain(rejectedId);

		const jsonInspect = JSON.parse(
			(await runCli(["task", "inspect", taskId, "--json"], dbPath)).stdout[0] ?? "",
		) as { artifacts: { id: string; body: string }[] };
		expect(jsonInspect.artifacts).toEqual([
			expect.objectContaining({ id: activeId, body: "active body\n" }),
		]);

		const descendantId = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"artifact descendant",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				taskId,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "descendant body" },
		).then((result) => (JSON.parse(result.stdout[0] ?? "") as { task: { id: string } }).task.id);
		const lineageInspect = JSON.parse(
			(await runCli(["task", "inspect", descendantId, "--json"], dbPath)).stdout[0] ?? "",
		) as { lineage: { task: { id: string }; artifacts: { id: string }[] }[] };
		expect(lineageInspect.lineage.find((entry) => entry.task.id === taskId)?.artifacts).toEqual([
			expect.objectContaining({ id: activeId }),
		]);

		const fullJson = await runCli(["task", "inspect", taskId, "--full", "--json"], dbPath);
		expect(JSON.parse(fullJson.stderr[0] ?? "")).toEqual({
			ok: false,
			error: { code: "VALIDATION_ERROR", message: "--full cannot be used with --json" },
		});

		const graphText =
			(await runCli(["graph", "inspect", "--task", taskId], dbPath)).stdout[0] ?? "";
		expect(graphText).toContain(`- ${activeId} [note] active evidence`);
		expect(graphText).not.toContain("artifacts: none");
		expect(graphText).not.toContain(rejectedId);
		const graphJson = JSON.parse(
			(await runCli(["graph", "inspect", "--task", taskId, "--json"], dbPath)).stdout[0] ?? "",
		) as { graph: { nodes: { id: string; artifact_refs: { id: string }[] }[] } };
		expect(graphJson.graph.nodes.find((node) => node.id === taskId)?.artifact_refs).toEqual([
			expect.objectContaining({ id: activeId }),
		]);
	});

	it("validates artifact add stdin availability and non-empty content", async () => {
		for (const stdin of [
			{ _tag: "NoRedirectedStdin" as const },
			{ _tag: "RedirectedText" as const, text: "" },
		]) {
			const result = await runCli(artifactAddArgs("task_missing", ["--stdin"]), tempDb(), stdin);
			expect(JSON.parse(result.stderr[0] ?? "")).toMatchObject({
				ok: false,
				error: { code: "VALIDATION_ERROR" },
			});
			expect(result.exitCode).toBe(2);
			expect(result.configRead).toBe(false);
		}
	});

	it("surfaces artifact add stdin read failures as tagged JSON", async () => {
		const result = await runCli(artifactAddArgs("task_missing", ["--stdin"]), tempDb(), {
			_tag: "ReadFailure",
			error: new PithosError({ code: "USER_ERROR", message: "stdin exploded" }),
		});
		expect(JSON.parse(result.stderr[0] ?? "")).toEqual({
			ok: false,
			error: { code: "USER_ERROR", message: "stdin exploded" },
		});
	});

	it("returns parser errors for positional artifact body", async () => {
		await expect(
			runCli(artifactAddArgs("task_missing", ["positional body"]), tempDb()),
		).rejects.toThrow("positional body");
	});

	it("returns parser errors for removed artifact add body-file flag", async () => {
		await expect(
			runCli(artifactAddArgs("task_missing", ["--body-file", "payload.txt"]), tempDb()),
		).rejects.toThrow("--body-file");
	});

	it("returns parser errors for removed artifact add task flag", async () => {
		await expect(
			runCli(
				[
					"task",
					"artifact",
					"add",
					"task_missing",
					"--kind",
					"note",
					"--title",
					"evidence",
					"--stdin",
					"--token",
					"1",
					"--task",
					"task_extra",
				],
				tempDb(),
			),
		).rejects.toThrow("--task");
	});

	it("completes with default result metadata without reading stdin", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await runCli(["scope", "upsert", "--kind", "repo", "--path", "/tmp/pithos-cli"], dbPath);
		await upsertRun(dbPath, "run_toil");
		await upsertRepoWarRun(dbPath);
		const taskId = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"repo:/tmp/pithos-cli",
				"--capability",
				"execute",
				"--title",
				"complete task",
				"--stdin",
				"--run",
				"run_toil",
			],
			dbPath,
			{ _tag: "RedirectedText", text: "body" },
		).then((r) => (JSON.parse(r.stdout[0] ?? "") as { task: { id: string } }).task.id);
		await runCli(
			[
				"task",
				"claim",
				"--run",
				"run_war",
				"--scope",
				"repo:/tmp/pithos-cli",
				"--capability",
				"execute",
			],
			dbPath,
		);

		const result = await runCli(completeArgs(taskId), dbPath, {
			_tag: "ReadFailure",
			error: new PithosError({ code: "USER_ERROR", message: "stdin should not be read" }),
		});

		expect(JSON.parse(result.stdout[0] ?? "")).toEqual({
			ok: true,
			task: { id: taskId, status: "done" },
		});
		expect(result.stdinReads()).toBe(0);
		expect(taskResultJson(dbPath, taskId)).toBe("{}");
	});

	it("completes with JSON object result metadata from explicit stdin", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await runCli(["scope", "upsert", "--kind", "repo", "--path", "/tmp/pithos-cli"], dbPath);
		await upsertRun(dbPath, "run_toil");
		await upsertRepoWarRun(dbPath);
		const taskId = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"repo:/tmp/pithos-cli",
				"--capability",
				"execute",
				"--title",
				"metadata task",
				"--stdin",
				"--run",
				"run_toil",
			],
			dbPath,
			{ _tag: "RedirectedText", text: "body" },
		).then((r) => (JSON.parse(r.stdout[0] ?? "") as { task: { id: string } }).task.id);
		await runCli(
			[
				"task",
				"claim",
				"--run",
				"run_war",
				"--scope",
				"repo:/tmp/pithos-cli",
				"--capability",
				"execute",
			],
			dbPath,
		);

		const result = await runCli(completeArgs(taskId, ["--stdin"]), dbPath, {
			_tag: "RedirectedText",
			text: '{"ok":true}',
		});

		expect(result.stdinReads()).toBe(1);
		expect(taskResultJson(dbPath, taskId)).toBe('{"ok":true}');
	});

	it("validates complete stdin availability, empty content, invalid JSON, and non-object JSON", async () => {
		for (const stdin of [
			{ _tag: "NoRedirectedStdin" as const },
			{ _tag: "RedirectedText" as const, text: "" },
			{ _tag: "RedirectedText" as const, text: "not json" },
			{ _tag: "RedirectedText" as const, text: "[]" },
			{ _tag: "RedirectedText" as const, text: '"text"' },
			{ _tag: "RedirectedText" as const, text: "1" },
			{ _tag: "RedirectedText" as const, text: "true" },
			{ _tag: "RedirectedText" as const, text: "null" },
		]) {
			const result = await runCli(completeArgs("task_missing", ["--stdin"]), tempDb(), stdin);
			expect(JSON.parse(result.stderr[0] ?? "")).toMatchObject({
				ok: false,
				error: { code: "VALIDATION_ERROR" },
			});
			expect(result.exitCode).toBe(2);
			expect(result.configRead).toBe(false);
		}
	});

	it("returns parser errors for removed complete result-file flag", async () => {
		await expect(
			runCli(completeArgs("task_missing", ["--result-file", "result.json"]), tempDb()),
		).rejects.toThrow("--result-file");
	});

	it("defaults enqueue chain to auto and returns deterministic chain metadata", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const result = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"default chain",
				"--stdin",
				"--run",
				"run_toil",
			],
			dbPath,
			{ _tag: "RedirectedText", text: "body" },
		);
		const output = JSON.parse(result.stdout[0] ?? "") as {
			readonly task: { readonly id: string };
			readonly chain: unknown;
		};
		expect(output.chain).toEqual({
			policy: "auto",
			applied: "flat_no_held_task",
			held_task_id: null,
			source_task_id: null,
			source_kind: null,
			implicit_dependency_ids: [],
			final_dependency_ids: [],
		});
		expect(taskCreatedPayload(dbPath, output.task.id)).toMatchObject({ chain: output.chain });
	});

	it("keeps --chain none manual-only with explicit dependencies", async () => {
		const dbPath = tempDb();
		await runCli(["init", "--fresh"], dbPath);
		await upsertRun(dbPath, "run_toil");
		const blocker = await enqueueGlobalTriage(dbPath, "run_toil", "manual blocker", "body");
		const result = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"design",
				"--title",
				"manual child",
				"--stdin",
				"--run",
				"run_toil",
				"--chain",
				"none",
				"--after",
				blocker,
			],
			dbPath,
			{ _tag: "RedirectedText", text: "body" },
		);
		const output = JSON.parse(result.stdout[0] ?? "") as {
			readonly task: { readonly id: string };
			readonly chain: unknown;
		};
		expect(output.chain).toEqual({
			policy: "none",
			applied: "none_selected",
			held_task_id: null,
			source_task_id: null,
			source_kind: null,
			implicit_dependency_ids: [],
			final_dependency_ids: [blocker],
		});
		expect(taskDependencies(dbPath, output.task.id)).toEqual([blocker]);
	});

	it("returns validation JSON for invalid --chain values before loading config", async () => {
		const result = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"bad chain",
				"--stdin",
				"--chain",
				"bogus",
			],
			tempDb(),
			{ _tag: "RedirectedText", text: "body" },
		);
		expect(JSON.parse(result.stderr[0] ?? "")).toEqual({
			ok: false,
			error: {
				code: "VALIDATION_ERROR",
				message: "Invalid --chain value: 'bogus'. Valid values: auto, none, held",
			},
		});
		expect(result.exitCode).toBe(2);
		expect(result.configRead).toBe(false);
	});

	it("accepts held mode and rejects source mode", async () => {
		for (const chain of ["held"] as const) {
			const dbPath = tempDb();
			await runCli(["init", "--fresh"], dbPath);
			await upsertRun(dbPath, "run_toil");
			const result = await runCli(
				[
					"task",
					"enqueue",
					"--scope",
					"global",
					"--capability",
					"triage",
					"--title",
					`${chain} chain`,
					"--stdin",
					"--run",
					"run_toil",
					"--chain",
					chain,
				],
				dbPath,
				{ _tag: "RedirectedText", text: "body" },
			);
			expect(JSON.parse(result.stderr[0] ?? "")).toEqual({
				ok: false,
				error: { code: "VALIDATION_ERROR", message: `--chain ${chain} requires a held task` },
			});
			expect(result.exitCode).toBe(2);
		}
		const source = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"source chain",
				"--stdin",
				"--chain",
				"source",
			],
			tempDb(),
			{ _tag: "RedirectedText", text: "body" },
		);
		expect(JSON.parse(source.stderr[0] ?? "")).toEqual({
			ok: false,
			error: {
				code: "VALIDATION_ERROR",
				message: "Invalid --chain value: 'source'. Valid values: auto, none, held",
			},
		});
		expect(source.exitCode).toBe(2);
	});

	it("returns validation JSON when enqueue omits --stdin", async () => {
		const result = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"missing stdin",
			],
			tempDb(),
		);
		expect(JSON.parse(result.stderr[0] ?? "")).toMatchObject({
			ok: false,
			error: { code: "VALIDATION_ERROR" },
		});
		expect(result.exitCode).toBe(2);
		expect(result.configRead).toBe(false);
	});

	it("validates required stdin availability and non-empty content", async () => {
		for (const stdin of [
			{ _tag: "NoRedirectedStdin" as const },
			{ _tag: "RedirectedText" as const, text: "" },
		]) {
			const result = await runCli(
				[
					"task",
					"enqueue",
					"--scope",
					"global",
					"--capability",
					"triage",
					"--title",
					"bad stdin",
					"--stdin",
				],
				tempDb(),
				stdin,
			);
			expect(JSON.parse(result.stderr[0] ?? "")).toMatchObject({
				ok: false,
				error: { code: "VALIDATION_ERROR" },
			});
			expect(result.exitCode).toBe(2);
		}
	});

	it("surfaces stdin read failures as tagged JSON", async () => {
		const result = await runCli(
			[
				"task",
				"enqueue",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"read failure",
				"--stdin",
			],
			tempDb(),
			{
				_tag: "ReadFailure",
				error: new PithosError({ code: "USER_ERROR", message: "stdin exploded" }),
			},
		);
		expect(JSON.parse(result.stderr[0] ?? "")).toEqual({
			ok: false,
			error: { code: "USER_ERROR", message: "stdin exploded" },
		});
	});

	it("renders top-level --help as human help without loading config", async () => {
		for (const flag of ["--help", "-h"] as const) {
			const result = await runCli([flag], tempDb());
			expect(result.configRead).toBe(false);
			expect(result.stderr).toEqual([]);
			expect(result.stdout).toMatchSnapshot();
		}
	});

	it("renders top-level --help-json as stable JSON without loading config", async () => {
		const result = await runCli(["--help-json"], tempDb());
		expect(result.configRead).toBe(false);
		expect(result.stderr).toEqual([]);
		const help = JSON.parse(result.stdout[0] ?? "") as PithosHelpCommand;
		expect(help).toMatchObject({
			tool: "pithos",
			name: "pithos",
			path: "pithos",
			usage: "pithos <command>",
			description:
				"Durable state CLI for tasks, runs, claims, artifacts, events, and graph invariants.",
		});
		expect(help.subcommands.map((command) => command.path)).toEqual([
			"pithos init",
			"pithos scope",
			"pithos run",
			"pithos task",
			"pithos graph",
			"pithos events",
			"pithos briefing",
		]);
		expect(
			help.subcommands.find((command) => command.path === "pithos scope")?.subcommands,
		).toMatchObject([
			{ path: "pithos scope upsert" },
			{ path: "pithos scope list" },
			{ path: "pithos scope archive" },
		]);
		expect(
			help.subcommands.find((command) => command.path === "pithos run")?.subcommands?.length,
		).toBeGreaterThan(0);
	});

	it("rejects --help-json when combined with other arguments", async () => {
		const result = await runCli(["--help-json", "task"], tempDb());
		expect(result.configRead).toBe(false);
		expect(result.stdout).toEqual([]);
		expect(JSON.parse(result.stderr[0] ?? "")).toEqual({
			ok: false,
			error: {
				code: "VALIDATION_ERROR",
				message: "--help-json must be the only pithos argument",
			},
		});
		expect(result.exitCode).toBe(2);
	});

	it("renders artifact add and context format flags in help JSON", async () => {
		const result = await runCli(["--help-json"], tempDb());
		const help = JSON.parse(result.stdout[0] ?? "") as PithosHelpCommand;
		const flatten = (command: PithosHelpCommand): readonly PithosHelpCommand[] => [
			command,
			...command.subcommands.flatMap(flatten),
		];
		const commands = flatten(help);
		const artifactAdd = commands.find((command) => command.path === "pithos task artifact add");
		expect(artifactAdd).toBeDefined();
		expect(artifactAdd?.usage).toContain("--token");
		expect(artifactAdd?.usage).toContain("--kind");
		expect(artifactAdd?.usage).toContain("--title");
		expect(artifactAdd?.description).toContain("held task");
		expect(commands.filter((command) => command.path === "pithos task artifact add")).toHaveLength(
			1,
		);
		const artifactReject = commands.find(
			(command) => command.path === "pithos task artifact reject",
		);
		expect(artifactReject?.usage).toContain("--token");
		expect(artifactReject?.usage).toContain("--reason");
		expect(artifactReject?.description).toContain("Reject an active artifact");
		expect(
			commands.find((command) => command.path === "pithos task artifact list")?.usage,
		).toContain("--json");
		expect(
			commands.find((command) => command.path === "pithos task artifact show")?.usage,
		).toContain("--json");
		expect(commands.some((command) => command.path === "pithos task task artifact add")).toBe(
			false,
		);
		expect(result.stdout.join("").match(/pithos task artifact add/g)).toHaveLength(1);
		expect(commands.find((command) => command.path === "pithos task inspect")?.usage).toContain(
			"--json",
		);
		expect(commands.find((command) => command.path === "pithos graph inspect")?.usage).toContain(
			"--json",
		);
		expect(commands.find((command) => command.path === "pithos graph inspect")?.usage).toContain(
			"--status",
		);
		expect(commands.find((command) => command.path === "pithos graph inspect")?.usage).toContain(
			"--search",
		);
		expect(commands.find((command) => command.path === "pithos graph inspect")?.usage).toContain(
			"--since",
		);
		expect(commands.find((command) => command.path === "pithos briefing")?.usage).toContain(
			"--json",
		);
	});
});
