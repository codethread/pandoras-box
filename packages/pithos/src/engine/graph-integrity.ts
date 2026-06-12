import type { Db } from "../db.js";
import { fail } from "../errors.js";
import { branchClosure, canonicalTaskId, taskEdges } from "./task-read-model.js";

const assertBlockingAcyclic = (db: Db): void => {
	const outgoing = new Map<string, string[]>();
	for (const edge of taskEdges(db).filter((row) => row.kind === "after" || row.kind === "gate")) {
		const owner = canonicalTaskId(db, edge.task_id);
		outgoing.set(owner, [...(outgoing.get(owner) ?? []), canonicalTaskId(db, edge.target_task_id)]);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id)) fail("VALIDATION_ERROR", "task blocking cycle detected");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const next of outgoing.get(id) ?? []) visit(next);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of outgoing.keys()) visit(id);
};

const assertGateOwnersOutsideTargetClosures = (db: Db): void => {
	for (const edge of taskEdges(db).filter((row) => row.kind === "gate")) {
		const owner = canonicalTaskId(db, edge.task_id);
		if (
			branchClosure(db, edge.target_task_id).some((member) => member.canonical_task_id === owner)
		) {
			fail("VALIDATION_ERROR", "gate owner is already in target branch closure");
		}
	}
};

const assertMembershipAcyclic = (db: Db): void => {
	const outgoing = new Map<string, string[]>();
	for (const edge of taskEdges(db).filter((row) => row.kind !== "gate")) {
		const owner = canonicalTaskId(db, edge.task_id);
		outgoing.set(owner, [...(outgoing.get(owner) ?? []), canonicalTaskId(db, edge.target_task_id)]);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id)) fail("VALIDATION_ERROR", "task branch-membership cycle detected");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const next of outgoing.get(id) ?? []) visit(next);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of outgoing.keys()) visit(id);
};

export const assertGraphIntegrity = (db: Db): void => {
	assertMembershipAcyclic(db);
	assertGateOwnersOutsideTargetClosures(db);
	assertBlockingAcyclic(db);
};
