import { Effect } from "effect";
import { PdxError } from "./errors.js";
import type { ProcessService } from "./services.js";

export type RepoLaunchProbeResult =
	| {
			readonly _tag: "OnDefaultBranch";
			readonly path: string;
			readonly gitRoot: string;
			readonly currentBranch: string;
			readonly defaultBranch: string;
	  }
	| {
			readonly _tag: "NonDefaultBranch";
			readonly path: string;
			readonly gitRoot: string;
			readonly currentBranch: string;
			readonly defaultBranch: string;
	  }
	| { readonly _tag: "NotGitWorkTree"; readonly path: string }
	| { readonly _tag: "DetachedHead"; readonly path: string; readonly gitRoot: string }
	| {
			readonly _tag: "UnknownDefaultBranch";
			readonly path: string;
			readonly gitRoot: string;
			readonly currentBranch: string;
	  };

export interface RepoLaunchChecksService {
	readonly probeDefaultBranch: (path: string) => Effect.Effect<RepoLaunchProbeResult, PdxError>;
}

const trimSingleLine = (value: string) => value.trim();

const git = (process: ProcessService, cwd: string, args: readonly string[]) =>
	process.execFile("git", args, { cwd });

const unexpectedGitFailure = (path: string, command: string, stderr: string) =>
	new PdxError({
		code: "PROCESS_ERROR",
		message: `${command} failed for ${path}: ${stderr.trim()}`,
	});

const isNotGitWorkTree = (stderr: string) => stderr.includes("not a git repository");

const isDetachedHead = (stderr: string) =>
	stderr.trim().length === 0 || stderr.includes("not a symbolic ref");

export const makeGitRepoLaunchChecks = (process: ProcessService): RepoLaunchChecksService => ({
	probeDefaultBranch: (path) =>
		Effect.gen(function* () {
			const root = yield* git(process, path, ["rev-parse", "--show-toplevel"]);
			if (root.exitCode !== 0) {
				if (isNotGitWorkTree(root.stderr)) return { _tag: "NotGitWorkTree" as const, path };
				return yield* Effect.fail(
					unexpectedGitFailure(path, "git rev-parse --show-toplevel", root.stderr),
				);
			}
			const gitRoot = trimSingleLine(root.stdout);

			const branch = yield* git(process, gitRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
			if (branch.exitCode !== 0) {
				if (isDetachedHead(branch.stderr)) return { _tag: "DetachedHead" as const, path, gitRoot };
				return yield* Effect.fail(
					unexpectedGitFailure(gitRoot, "git symbolic-ref --quiet --short HEAD", branch.stderr),
				);
			}
			const currentBranch = trimSingleLine(branch.stdout);

			const defaultRef = yield* git(process, gitRoot, [
				"symbolic-ref",
				"--quiet",
				"--short",
				"refs/remotes/origin/HEAD",
			]);
			if (defaultRef.exitCode !== 0) {
				return { _tag: "UnknownDefaultBranch" as const, path, gitRoot, currentBranch };
			}
			const defaultRefName = trimSingleLine(defaultRef.stdout);
			if (!defaultRefName.startsWith("origin/") || defaultRefName === "origin/HEAD") {
				return { _tag: "UnknownDefaultBranch" as const, path, gitRoot, currentBranch };
			}
			const defaultBranch = defaultRefName.slice("origin/".length);

			if (currentBranch === defaultBranch) {
				return {
					_tag: "OnDefaultBranch" as const,
					path,
					gitRoot,
					currentBranch,
					defaultBranch,
				};
			}
			return {
				_tag: "NonDefaultBranch" as const,
				path,
				gitRoot,
				currentBranch,
				defaultBranch,
			};
		}),
});
