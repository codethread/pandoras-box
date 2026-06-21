import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { FagentError, runFagentDetailed, type FagentServices } from "./index.js";

process.env.FAGENT_INSTANCE_ID = randomUUID();
process.env.FAGENT_PROCESS_ID = String(process.pid);

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

const writeOutput = (output: string) =>
	process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);

const exitWithError = (error: unknown): never => {
	if (error instanceof FagentError) {
		process.stderr.write(`${error.code}: ${error.message}\n`);
		process.exit(1);
	}
	process.stderr.write(`FAGENT_ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
};

try {
	const startup = runFagentDetailed(process.argv.slice(2), process.cwd(), liveServices);
	writeOutput(startup.output);
	if (startup.resident) {
		const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
		lines.on("line", (line) => {
			try {
				writeOutput(
					runFagentDetailed(
						["--config", startup.configPath, "--print", line],
						process.cwd(),
						liveServices,
					).output,
				);
			} catch (error) {
				exitWithError(error);
			}
		});
	}
} catch (error) {
	exitWithError(error);
}
