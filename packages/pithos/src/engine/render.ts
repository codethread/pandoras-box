import type { Capability, TaskStatus } from "../db.js";
import type {
	ArtifactDetailOutput,
	ArtifactMetadataOutput,
	ArtifactOutput,
	BriefingOutput,
	GateInspectOutput,
	GraphInspectOutput,
	LateGrowthMarkerOutput,
	TaskDetailOutput,
	TaskInspectOutput,
	TaskSourceSummaryOutput,
	TaskSummaryOutput,
} from "./types.js";

const taskTitleLine = (task: {
	readonly id: string;
	readonly capability: Capability;
	readonly status: TaskStatus;
	readonly title: string;
}): string => `${task.id} [${task.capability}] [${task.status}] ${task.title}`;

const graphTaskTitleLine = (task: {
	readonly id: string;
	readonly capability: Capability;
	readonly status: TaskStatus;
	readonly title: string;
}): string => `${task.id} [${task.capability}] [${task.status}] ${task.title}`;

const ansi = {
	reset: "\u001b[0m",
	bold: "\u001b[1m",
	dim: "\u001b[2m",
	red: "\u001b[31m",
	green: "\u001b[32m",
	yellow: "\u001b[33m",
	blue: "\u001b[34m",
	cyan: "\u001b[36m",
};

const color = (enabled: boolean, code: string, text: string): string =>
	enabled ? `${code}${text}${ansi.reset}` : text;

const taskStatusColor = (status: TaskStatus): string => {
	switch (status) {
		case "queued":
			return ansi.yellow;
		case "claimed":
		case "running":
			return ansi.blue;
		case "done":
			return ansi.green;
		case "failed":
			return ansi.red;
		case "dead_letter":
			return `${ansi.bold}${ansi.red}`;
		case "cancelled":
			return ansi.dim;
	}
};

const capabilityColor = (): string => `${ansi.dim}${ansi.cyan}`;

const graphTaskTitleLineColored = (
	task: {
		readonly id: string;
		readonly capability: Capability;
		readonly status: TaskStatus;
		readonly title: string;
	},
	enabled: boolean,
): string => {
	if (!enabled) return graphTaskTitleLine(task);
	return `${color(enabled, taskStatusColor(task.status), task.id)} ${color(enabled, capabilityColor(), `[${task.capability}]`)} [${task.status}] ${task.title}`;
};

const fencedMarkdown = (body: string): string => {
	const longestBacktickRun = Math.max(
		0,
		...[...body.matchAll(/`+/g)].map((match) => match[0]?.length ?? 0),
	);
	const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
	return `${fence}md\n${body}\n${fence}`;
};

const renderArtifactMarkdown = (artifact: ArtifactOutput): string =>
	`Artifact ${artifact.id} [${artifact.kind}] ${artifact.title}:\n\n${fencedMarkdown(artifact.body)}`;

const renderArtifactReferenceMarkdown = (artifact: {
	readonly id: string;
	readonly kind: string;
	readonly title: string;
}): string => `- ${artifact.id} [${artifact.kind}] ${artifact.title}`;

const artifactMetadataForJson = ({
	body,
	...metadata
}: ArtifactDetailOutput): ArtifactMetadataOutput => {
	void body;
	return metadata;
};

export const renderArtifactListText = (artifacts: readonly ArtifactMetadataOutput[]): string =>
	`${artifacts
		.map((artifact) =>
			artifact.status === "rejected"
				? `- ${artifact.id} [${artifact.kind}] ${artifact.title} [rejected: ${artifact.rejection_reason}]`
				: `- ${artifact.id} [${artifact.kind}] ${artifact.title}`,
		)
		.join("\n")}${artifacts.length === 0 ? "- none" : ""}\n`;

export const renderArtifactShowText = (artifact: ArtifactDetailOutput): string =>
	`# ${artifact.id} [${artifact.kind}] ${artifact.title}\n\n\`\`\`json\n${JSON.stringify(artifactMetadataForJson(artifact), null, 2)}\n\`\`\`\n\n${fencedMarkdown(artifact.body)}\n`;

const renderTaskBullet = (task: TaskDetailOutput): string => `- ${taskTitleLine(task)}`;

const sourceKindLabel = (kind: "about" | "repair"): string =>
	kind === "about" ? "about" : "repair";

const renderSourceBullet = (source: TaskSourceSummaryOutput | null): string =>
	source === null
		? "- none"
		: `- ${sourceKindLabel(source.source_kind)} source: ${taskTitleLine(source)}`;

const renderAttachedContextBullet = (task: TaskSourceSummaryOutput): string =>
	`- ${sourceKindLabel(task.source_kind)} attached: ${taskTitleLine(task)}`;

const brokenStatuses = new Set<TaskStatus>(["failed", "cancelled", "dead_letter"]);

const gateRelevantMembers = (
	gate: Pick<GateInspectOutput, "state" | "members">,
): GateInspectOutput["members"] =>
	gate.state === "clear"
		? []
		: gate.members.filter((member) =>
				gate.state === "broken" ? brokenStatuses.has(member.status) : member.status !== "done",
			);

const renderGateMarkdown = (gate: GateInspectOutput): string => {
	const lines = [`- ${gate.target_task_id} [${gate.state}]`];
	const members = gateRelevantMembers(gate);
	if (members.length > 0) {
		lines.push(`  ${gate.state === "broken" ? "Broken" : "Open"} branch members:`);
		for (const member of members) {
			const canonicalNote =
				member.canonical_task_id === member.task_id ? "" : ` canonical=${member.canonical_task_id}`;
			lines.push(`  - ${member.task_id} [${member.status}]${canonicalNote}`);
		}
	}
	return lines.join("\n");
};

const renderLateGrowthMarker = (marker: LateGrowthMarkerOutput): string =>
	marker.mutation_kind === "edge_inserted"
		? `- ${marker.id}: allowed late ${marker.edge_kind} edge ${marker.edge_task_id} -> ${marker.edge_target_task_id} after gate ${marker.gate_task_id} -> ${marker.gate_target_task_id} claim sequence ${marker.gate_claim_sequence} (attempt ${marker.gate_attempt})`
		: `- ${marker.id}: allowed late supersession ${marker.replacement_task_id} supersedes ${marker.superseded_task_id} after gate ${marker.gate_task_id} -> ${marker.gate_target_task_id} claim sequence ${marker.gate_claim_sequence} (attempt ${marker.gate_attempt})`;

const graphScopeLabel = (task: { readonly scope_id: string }): string => task.scope_id;

const renderGraphArtifactLines = (
	artifactRefs: readonly { readonly id: string; readonly kind: string; readonly title: string }[],
	depth: number,
): readonly string[] =>
	artifactRefs.length === 0
		? []
		: [
				`${"  ".repeat(depth)}artifacts:`,
				...artifactRefs.map(
					(artifact) =>
						`${"  ".repeat(depth + 1)}- ${artifact.id} [${artifact.kind}] ${artifact.title}`,
				),
			];

const graphSelectorLabel = (selector: GraphInspectOutput["graph"]["selector"]): string => {
	switch (selector.kind) {
		case "all":
			return "all";
		case "task":
			return `task ${selector.value}`;
		case "scope":
			return `scope ${selector.value}`;
	}
};

const renderGraphHeader = (graph: GraphInspectOutput["graph"]): string[] => [
	"# Task graph map",
	`selector: ${graphSelectorLabel(graph.selector)}`,
	"edges: owner/follow-up --kind--> referenced task",
	"layout: referenced task, then incoming owners",
	"legend: ↑ already shown · ↻ supersession history",
	"",
];

const renderGateMemberLines = (
	gate: Pick<GateInspectOutput, "state" | "members">,
	depth: number,
): string[] => {
	const members = gateRelevantMembers(gate);
	if (gate.state === "clear") return [`${"  ".repeat(depth)}branch members: all clear`];
	const lines = [`${"  ".repeat(depth)}${gate.state} members:`];
	for (const member of members) {
		const canonicalNote =
			member.canonical_task_id === member.task_id ? "" : ` canonical=${member.canonical_task_id}`;
		lines.push(
			`${"  ".repeat(depth + 1)}- member ${member.task_id} [${member.status}]${canonicalNote}`,
		);
	}
	return lines;
};

export const renderTaskInspectMarkdown = (
	inspect: TaskInspectOutput,
	fullArtifacts = false,
): string => {
	const sections = [`# ${taskTitleLine(inspect.task)}`];
	if (inspect.superseded_by !== null) {
		sections.push(`> ⚠️ This task has been superseded by ${inspect.superseded_by}`);
	}
	if (inspect.supersedes !== null) {
		sections.push(`> This task supersedes ${inspect.supersedes}`);
	}
	sections.push(`Body:\n\n${fencedMarkdown(inspect.task.body)}`);
	if (inspect.artifacts.length > 0) {
		sections.push(
			"Artifacts:",
			fullArtifacts
				? inspect.artifacts.map(renderArtifactMarkdown).join("\n\n")
				: inspect.artifacts.map(renderArtifactReferenceMarkdown).join("\n"),
		);
	}
	sections.push(
		"Direct after dependencies:",
		inspect.dependencies.length === 0
			? "- none"
			: inspect.dependencies.map(renderTaskBullet).join("\n"),
		"Direct after dependents:",
		inspect.dependents.length === 0
			? "- none"
			: inspect.dependents.map(renderTaskBullet).join("\n"),
		"Coordination gates:",
		inspect.task.gates.length === 0
			? "- none"
			: inspect.task.gates.map(renderGateMarkdown).join("\n"),
		"Attached context:",
		[
			...(inspect.source === null ? [] : [renderSourceBullet(inspect.source)]),
			...inspect.attached_context.map(renderAttachedContextBullet),
		].join("\n") || "- none",
	);
	if (inspect.repair_alert_kind !== null) {
		sections.push(`Repair Alert kind: ${inspect.repair_alert_kind}`);
	}
	if (inspect.late_growth_markers.length > 0) {
		sections.push(
			"Allowed late branch growth:",
			inspect.late_growth_markers.map(renderLateGrowthMarker).join("\n"),
		);
	}
	return sections.join("\n\n") + "\n";
};

export const renderGraphInspectText = (
	{ graph }: GraphInspectOutput,
	options: { readonly color?: boolean; readonly homeDir?: string | undefined } = {},
): string => {
	const colorEnabled = options.color ?? false;
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const childrenByParent = new Map<string, string[]>();
	const childIds = new Set<string>();
	const contextByTarget = new Map<
		string,
		{ readonly taskId: string; readonly kind: "about" | "repair" }[]
	>();
	const gatesByTarget = new Map<
		string,
		{
			readonly taskId: string;
			readonly state: "clear" | "open" | "broken";
			readonly members: GateInspectOutput["members"];
		}[]
	>();
	for (const edge of graph.edges) {
		if (edge.kind === "after") {
			if (!byId.has(edge.from_task_id) || !byId.has(edge.to_task_id)) continue;
			childrenByParent.set(edge.to_task_id, [
				...(childrenByParent.get(edge.to_task_id) ?? []),
				edge.from_task_id,
			]);
			childIds.add(edge.from_task_id);
			continue;
		}
		if (edge.kind === "about" || edge.kind === "repair") {
			if (!byId.has(edge.from_task_id) || !byId.has(edge.to_task_id)) continue;
			contextByTarget.set(edge.to_task_id, [
				...(contextByTarget.get(edge.to_task_id) ?? []),
				{ taskId: edge.from_task_id, kind: edge.kind },
			]);
			childIds.add(edge.from_task_id);
			continue;
		}
		if (edge.kind === "gate") {
			if (!byId.has(edge.from_task_id) || !byId.has(edge.to_task_id)) continue;
			gatesByTarget.set(edge.to_task_id, [
				...(gatesByTarget.get(edge.to_task_id) ?? []),
				{ taskId: edge.from_task_id, state: edge.state, members: edge.members },
			]);
			childIds.add(edge.from_task_id);
		}
	}
	const successorBySuperseded = new Map<string, string>();
	const successorIds = new Set<string>();
	for (const edge of graph.edges) {
		if (edge.kind !== "supersedes") continue;
		if (!byId.has(edge.from_task_id) || !byId.has(edge.to_task_id)) continue;
		successorBySuperseded.set(edge.to_task_id, edge.from_task_id);
		successorIds.add(edge.from_task_id);
	}
	for (const [parentId, childIds] of childrenByParent.entries()) {
		childrenByParent.set(
			parentId,
			[...childIds].sort((left, right) => {
				const leftNode = byId.get(left);
				const rightNode = byId.get(right);
				if (leftNode === undefined || rightNode === undefined) return left.localeCompare(right);
				return leftNode.title.localeCompare(rightNode.title) || left.localeCompare(right);
			}),
		);
	}
	const lines: string[] = renderGraphHeader(graph);
	const written = new Set<string>();
	const writeNodeLine = (
		id: string,
		depth: number,
		label: string | undefined,
		supersessionChild: boolean,
	): boolean => {
		const node = byId.get(id);
		if (node === undefined) return false;
		const prefix = supersessionChild
			? "↻ replaced-by "
			: label === undefined
				? "- "
				: `- ${label} ← `;
		if (written.has(id)) {
			lines.push(`${"  ".repeat(depth)}${prefix}↑ ${id} already shown`);
			return false;
		}
		lines.push(`${"  ".repeat(depth)}${prefix}${graphTaskTitleLineColored(node, colorEnabled)}`);
		lines.push(`${"  ".repeat(depth + 1)}scope: ${graphScopeLabel(node)}`);
		lines.push(`${"  ".repeat(depth + 1)}preview: ${node.preview ?? "none"}`);
		lines.push(...renderGraphArtifactLines(node.artifact_refs, depth + 1));
		written.add(id);
		return true;
	};
	const writeNodeChildren = (id: string, depth: number): void => {
		for (const context of contextByTarget.get(id) ?? [])
			writeNode(context.taskId, depth + 1, context.kind);
		for (const gate of gatesByTarget.get(id) ?? []) {
			const firstVisit = writeNodeLine(gate.taskId, depth + 1, `gate [${gate.state}]`, false);
			lines.push(...renderGateMemberLines(gate, depth + 2));
			if (firstVisit) writeNodeChildren(gate.taskId, depth + 1);
		}
		for (const childId of childrenByParent.get(id) ?? []) writeNode(childId, depth + 1, "after");
		const successorId = successorBySuperseded.get(id);
		if (successorId !== undefined) writeNode(successorId, depth + 1, undefined, true);
	};
	const writeNode = (
		id: string,
		depth: number,
		label: string | undefined = undefined,
		supersessionChild = false,
	): void => {
		if (writeNodeLine(id, depth, label, supersessionChild)) writeNodeChildren(id, depth);
	};
	for (const node of graph.nodes) {
		if (!childIds.has(node.id) && !successorIds.has(node.id)) writeNode(node.id, 0);
	}
	for (const node of graph.nodes) {
		if (!written.has(node.id)) writeNode(node.id, 0);
	}
	for (const marker of graph.late_growth_markers) {
		if (lines.length === 0 || lines[lines.length - 1] !== "Allowed late branch growth:") {
			lines.push("Allowed late branch growth:");
		}
		lines.push(renderLateGrowthMarker(marker));
	}
	return `${lines.join("\n")}\n`;
};

const renderBriefingTaskBullet = (task: TaskSummaryOutput): string => {
	const descNote = task.scope_description ? ` (${task.scope_description})` : "";
	return `- ${taskTitleLine(task)}${descNote}`;
};

export const renderBriefingText = (briefing: BriefingOutput): string => {
	const lines = ["# Briefing", "", "## Ready"];
	lines.push(
		...(briefing.ready.length === 0 ? ["- none"] : briefing.ready.map(renderBriefingTaskBullet)),
	);
	lines.push("", "## Blocked");
	if (briefing.blocked.length === 0) {
		lines.push("- none");
	} else {
		for (const task of briefing.blocked) {
			lines.push(renderBriefingTaskBullet(task));
			for (const blocker of task.blockers) {
				const descNote = blocker.scope_description ? ` (${blocker.scope_description})` : "";
				lines.push(
					`  - after blocker ${blocker.id} [${blocker.status}] scope=${blocker.scope_id}${descNote}`,
				);
			}
			for (const gate of task.gates) {
				lines.push(`  - gate ${gate.target_task_id} [${gate.state}]`);
				for (const member of gateRelevantMembers(gate)) {
					lines.push(`    - branch member ${member.task_id} [${member.status}]`);
				}
			}
		}
	}
	lines.push("", "## Recently Completed");
	lines.push(
		...(briefing.recentlyCompleted.length === 0
			? ["- none"]
			: briefing.recentlyCompleted.map(renderBriefingTaskBullet)),
	);
	return `${lines.join("\n")}\n`;
};
