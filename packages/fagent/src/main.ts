import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { FagentError, runFagent, type FagentServices } from "./index.js";

const liveServices: FagentServices = {
	readText: (path) => readFileSync(path, "utf8"),
	resolvePath: (cwd, path) => resolve(cwd, path),
	appendText: (path, text) => appendFileSync(path, text),
	execFile: (file, args, input) => {
		const result = spawnSync(file, [...args], { input, encoding: "utf8", env: process.env });
		if (result.status !== 0) {
			throw new FagentError({
				code: "SCRIPT_ERROR",
				message: `${file} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
			});
		}
		return result.stdout;
	},
	env: process.env,
};

try {
	const output = runFagent(process.argv.slice(2), process.cwd(), liveServices);
	process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
	if (output === "FAGENT_HITL_READY") {
		process.stdin.resume();
	}
} catch (error) {
	if (error instanceof FagentError) {
		process.stderr.write(`${error.code}: ${error.message}\n`);
		process.exit(1);
	}
	process.stderr.write(`FAGENT_ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
