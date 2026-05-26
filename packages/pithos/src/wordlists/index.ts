import { randomInt } from "node:crypto";
import words from "./eff-short.json" with { type: "json" };

export const friendlyIdWords: readonly string[] = words;

const pool: readonly string[] = friendlyIdWords;

// Exported for tests that want deterministic IDs.
export type Rng = () => number;

const defaultRng: Rng = () => randomInt(pool.length);

export const pickThreeWords = (rng: Rng = defaultRng): string =>
	`${pool[rng()]}-${pool[rng()]}-${pool[rng()]}`;
