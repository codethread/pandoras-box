import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { PdxError } from "../src/errors.js";
import { makeGitRepoLaunchChecks, type RepoLaunchProbeResult } from "../src/repo-launch-checks.js";
import { type ProcessResult } from "../src/services.js";
import { fakeProcess, run } from "./support.js";

const ok = (stdout: string): ProcessResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = "fatal"): ProcessResult => ({ exitCode: 1, stdout: "", stderr });

const probeWith = (
	responses: Record<string, ProcessResult>,
): Promise<{
	readonly result: RepoLaunchProbeResult;
	readonly calls: readonly string[];
}> => {
	const calls: string[] = [];
	const process = fakeProcess({
		execFile: (file, args, options) =>
			Effect.sync(() => {
				const command = `${file} ${args.join(" ")}`;
				calls.push(`${options?.cwd ?? ""}|${command}`);
				const response = responses[command];
				if (response === undefined) {
					throw new PdxError({
						code: "PROCESS_ERROR",
						message: `unexpected command: ${command}`,
					});
				}
				return response;
			}),
	});
	const service = makeGitRepoLaunchChecks(process);
	return run(
		service.probeDefaultBranch("/candidate").pipe(Effect.map((result) => ({ result, calls }))),
	);
};

const baseResponses = {
	"git rev-parse --show-toplevel": ok("/repo\n"),
	"git symbolic-ref --quiet --short HEAD": ok("main\n"),
	"git symbolic-ref --quiet --short refs/remotes/origin/HEAD": ok("origin/main\n"),
};

describe("repo launch checks", () => {
	it("reports success when the current branch equals origin's default branch", async () => {
		const { result } = await probeWith(baseResponses);

		expect(result).toEqual({
			_tag: "OnDefaultBranch",
			path: "/candidate",
			gitRoot: "/repo",
			currentBranch: "main",
			defaultBranch: "main",
		});
	});

	it("reports non-default branch evidence", async () => {
		const { result } = await probeWith({
			...baseResponses,
			"git symbolic-ref --quiet --short HEAD": ok("feature\n"),
		});

		expect(result).toEqual({
			_tag: "NonDefaultBranch",
			path: "/candidate",
			gitRoot: "/repo",
			currentBranch: "feature",
			defaultBranch: "main",
		});
	});

	it("reports detached HEAD distinctly", async () => {
		const { result } = await probeWith({
			...baseResponses,
			"git symbolic-ref --quiet --short HEAD": fail("not a symbolic ref"),
		});

		expect(result).toEqual({ _tag: "DetachedHead", path: "/candidate", gitRoot: "/repo" });
	});

	it("reports non-Git paths distinctly", async () => {
		const { result } = await probeWith({
			"git rev-parse --show-toplevel": fail("not a git repository"),
		});

		expect(result).toEqual({ _tag: "NotGitWorkTree", path: "/candidate" });
	});

	it("reports unknown default branch without contacting the remote", async () => {
		const { result, calls } = await probeWith({
			...baseResponses,
			"git symbolic-ref --quiet --short refs/remotes/origin/HEAD": fail(
				"refs/remotes/origin/HEAD missing",
			),
		});

		expect(result).toEqual({
			_tag: "UnknownDefaultBranch",
			path: "/candidate",
			gitRoot: "/repo",
			currentBranch: "main",
		});
		expect(calls.map((call) => call.split("|")[1])).toEqual([
			"git rev-parse --show-toplevel",
			"git symbolic-ref --quiet --short HEAD",
			"git symbolic-ref --quiet --short refs/remotes/origin/HEAD",
		]);
		expect(calls.join("\n")).not.toMatch(/fetch|ls-remote|remote set-head|checkout|switch/);
	});

	it("reports unknown default branch for unusable origin HEAD metadata", async () => {
		const { result } = await probeWith({
			...baseResponses,
			"git symbolic-ref --quiet --short refs/remotes/origin/HEAD": ok("origin/HEAD\n"),
		});

		expect(result).toEqual({
			_tag: "UnknownDefaultBranch",
			path: "/candidate",
			gitRoot: "/repo",
			currentBranch: "main",
		});
	});

	it("returns a tagged error for unexpected subprocess failures", async () => {
		await expect(
			probeWith({
				"git rev-parse --show-toplevel": fail("fatal: unsafe repository"),
			}),
		).rejects.toThrow("git rev-parse --show-toplevel failed");
	});
});
