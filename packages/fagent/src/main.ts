import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FagentError, runFagent, type FagentServices } from "./index.js";

const liveServices: FagentServices = {
	readText: (path) => readFileSync(path, "utf8"),
	resolvePath: (cwd, path) => resolve(cwd, path),
};

try {
	const output = runFagent(process.argv.slice(2), process.cwd(), liveServices);
	process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
} catch (error) {
	if (error instanceof FagentError) {
		process.stderr.write(`${error.code}: ${error.message}\n`);
		process.exit(1);
	}
	process.stderr.write(`FAGENT_ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
