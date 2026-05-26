#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { get_encoding } from "tiktoken";

const usage = `Usage: node packages/pithos/scripts/check-word-tokens.mjs [--encoding o200k_base] [--max N] [word ...]

When no words are passed, reads newline-delimited words from stdin.
Prints: word<TAB>token_count<TAB>token_ids`;

const args = process.argv.slice(2);
let encodingName = "o200k_base";
let max;
const words = [];

for (let i = 0; i < args.length; i += 1) {
	const arg = args[i];
	if (arg === "--") continue;
	if (arg === "--help" || arg === "-h") {
		console.log(usage);
		process.exit(0);
	}
	if (arg === "--encoding") {
		const value = args[i + 1];
		if (value === undefined) throw new Error("--encoding requires a value");
		encodingName = value;
		i += 1;
		continue;
	}
	if (arg === "--max") {
		const value = args[i + 1];
		if (value === undefined) throw new Error("--max requires a value");
		max = Number.parseInt(value, 10);
		if (!Number.isSafeInteger(max) || max < 1) throw new Error("--max must be a positive integer");
		i += 1;
		continue;
	}
	words.push(arg);
}

if (words.length === 0 && !process.stdin.isTTY) {
	words.push(
		...readFileSync(0, "utf8")
			.split(/\r?\n/)
			.map((word) => word.trim())
			.filter(Boolean),
	);
}

if (words.length === 0) {
	console.error(usage);
	process.exit(1);
}

const encoding = get_encoding(encodingName);
try {
	let failed = false;
	for (const word of words) {
		const tokens = [...encoding.encode(word)];
		console.log(`${word}\t${tokens.length}\t${tokens.join(",")}`);
		if (max !== undefined && tokens.length > max) failed = true;
	}
	if (failed) process.exitCode = 1;
} finally {
	encoding.free();
}
