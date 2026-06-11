import type { ArtifactContract, ArtifactContractRule } from "../artifact-contracts.js";
import type { Capability, Db } from "../db.js";
import { sql } from "../db.js";

export const requiredArtifactRules = (
	contract: ArtifactContract,
	capability: Capability,
): readonly ArtifactContractRule[] =>
	contract.artifacts.filter((rule) => rule.capability === capability && rule.required);

export const activeArtifactKinds = (db: Db, taskId: string): ReadonlySet<string> =>
	new Set(
		(
			db
				.prepare(sql`SELECT DISTINCT kind FROM artifacts WHERE task_id=? AND status='active'`)
				.all(taskId) as { readonly kind: string }[]
		).map((row) => row.kind),
	);

export const missingRequiredRules = (
	rules: readonly ArtifactContractRule[],
	presentKinds: ReadonlySet<string>,
): readonly ArtifactContractRule[] => rules.filter((rule) => !presentKinds.has(rule.kind));

export const missingRequiredKinds = (
	db: Db,
	taskId: string,
	rules: readonly ArtifactContractRule[],
): readonly string[] =>
	missingRequiredRules(rules, activeArtifactKinds(db, taskId)).map((rule) => rule.kind);

export const formatMissingRequiredRules = (rules: readonly ArtifactContractRule[]): string =>
	rules.map((rule) => `${rule.kind} (${rule.title})`).join(", ");
