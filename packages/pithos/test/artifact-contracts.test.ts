import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	loadArtifactContract,
	parseArtifactContractToml,
	selectArtifactContractRules,
	type FsService,
} from "../src/index.js";

const env = (userDataDir?: string) => ({
	get: (name: string) => (name === "PDX_USER_DATA_DIR" ? userDataDir : undefined),
});

const fsService = (
	files: Record<string, string>,
	directories: readonly string[] = [],
): FsService => ({
	existsDirectory: (path) => Effect.succeed(directories.includes(path)),
	readText: (path) =>
		path in files
			? Effect.succeed(files[path] ?? "")
			: Effect.fail({ _tag: "PithosError", code: "USER_ERROR", message: "ENOENT" } as never),
	removeFile: () => Effect.void,
});

const validToml = `[[artifacts]]
capability = "clarify"
kind = "open_questions"
title = "Open questions"
body = "List questions."

[[artifacts]]
capability = "execute"
kind = "patch_summary"
required = true
title = "Patch summary"
body = "Summarize the patch."
`;

describe("artifact contract parser", () => {
	it("returns an empty contract when PDX_USER_DATA_DIR is unset", () => {
		expect(Effect.runSync(loadArtifactContract(env(), fsService({})))).toEqual({ artifacts: [] });
	});

	it("fails loudly when PDX_USER_DATA_DIR is empty or not an inspectable directory", () => {
		expect(() => Effect.runSync(loadArtifactContract(env(""), fsService({})))).toThrow(
			/PDX_USER_DATA_DIR is not an inspectable directory/,
		);
		expect(() => Effect.runSync(loadArtifactContract(env("/missing"), fsService({})))).toThrow(
			/PDX_USER_DATA_DIR is not an inspectable directory/,
		);
	});

	it("returns an empty contract when artifacts.toml is absent", () => {
		expect(Effect.runSync(loadArtifactContract(env("/user"), fsService({}, ["/user"])))).toEqual({
			artifacts: [],
		});
	});

	it("loads and normalizes artifacts.toml from PDX_USER_DATA_DIR", () => {
		expect(
			Effect.runSync(
				loadArtifactContract(
					env("/user"),
					fsService({ "/user/artifacts.toml": validToml }, ["/user"]),
				),
			),
		).toEqual({
			artifacts: [
				{
					capability: "clarify",
					kind: "open_questions",
					required: false,
					title: "Open questions",
					body: "List questions.",
				},
				{
					capability: "execute",
					kind: "patch_summary",
					required: true,
					title: "Patch summary",
					body: "Summarize the patch.",
				},
			],
		});
	});

	it("selects rules for a set of capabilities", () => {
		const contract = parseArtifactContractToml(validToml);
		expect(selectArtifactContractRules(contract, ["execute"])).toEqual({
			artifacts: [contract.artifacts[1]],
		});
	});

	it("fails on invalid TOML", () => {
		expect(() => parseArtifactContractToml("[[artifacts]\n")).toThrow(/invalid artifacts.toml/);
	});

	it("fails loudly through the loader when artifacts.toml is invalid", () => {
		expect(() =>
			Effect.runSync(
				loadArtifactContract(
					env("/user"),
					fsService({ "/user/artifacts.toml": "[[artifacts]\n" }, ["/user"]),
				),
			),
		).toThrow(/invalid artifacts.toml/);
	});

	it("fails on unknown top-level fields", () => {
		expect(() => parseArtifactContractToml("extra = true\n")).toThrow(/unknown artifacts.toml/);
	});

	it("fails on unknown rule fields", () => {
		expect(() =>
			parseArtifactContractToml(`[[artifacts]]
capability = "clarify"
kind = "open_questions"
title = "Open questions"
body = "List questions."
extra = true
`),
		).toThrow(/unknown artifacts\[0\] field: extra/);
	});

	it("fails on bad capability", () => {
		expect(() =>
			parseArtifactContractToml(`[[artifacts]]
capability = "unknown"
kind = "open_questions"
title = "Open questions"
body = "List questions."
`),
		).toThrow(/not a built-in Capability/);
	});

	it("fails on bad kind", () => {
		expect(() =>
			parseArtifactContractToml(`[[artifacts]]
capability = "clarify"
kind = "OpenQuestions"
title = "Open questions"
body = "List questions."
`),
		).toThrow(/lower snake case/);
	});

	it("fails on empty title or body", () => {
		expect(() =>
			parseArtifactContractToml(`[[artifacts]]
capability = "clarify"
kind = "open_questions"
title = ""
body = "List questions."
`),
		).toThrow(/title must be non-empty/);
		expect(() =>
			parseArtifactContractToml(`[[artifacts]]
capability = "clarify"
kind = "open_questions"
title = "Open questions"
body = "   "
`),
		).toThrow(/body must be non-empty/);
	});

	it("fails on duplicate capability and kind", () => {
		expect(() =>
			parseArtifactContractToml(`[[artifacts]]
capability = "clarify"
kind = "open_questions"
title = "Open questions"
body = "List questions."

[[artifacts]]
capability = "clarify"
kind = "open_questions"
required = true
title = "Duplicate"
body = "List questions."
`),
		).toThrow(/duplicate artifact rule/);
	});

	it("can be imported through the public package boundary", async () => {
		const pithos = await import("../src/index.js");
		expect(pithos.parseArtifactContractToml(validToml).artifacts).toHaveLength(2);
	});
});
