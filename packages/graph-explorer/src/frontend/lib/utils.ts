const HTML_ESCAPE_ENTRIES: readonly [string, string][] = [
	["&", "&amp;"],
	["<", "&lt;"],
	[">", "&gt;"],
	['"', "&quot;"],
	["'", "&#39;"],
];

export const joinRenderedLines = (lines: readonly string[]): string => lines.join("\n");

export const escapeHtml = (value: string): string => {
	let result = value;
	for (const [needle, replacement] of HTML_ESCAPE_ENTRIES) {
		result = result.replaceAll(needle, replacement);
	}
	return result;
};

export const summarizeCountMap = (counts: ReadonlyMap<string, number>): readonly string[] =>
	Array.from(counts.entries())
		.filter(([, count]) => count > 0)
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.map(([label, count]) => `${label}: ${String(count)}`);

export const formatIsoTimestamp = (value: string | null | undefined): string => {
	if (value === null || value === undefined || value.length === 0) {
		return "—";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return date.toLocaleString();
};

export const formatRelativeAge = (value: string | null | undefined, now = new Date()): string => {
	if (value === null || value === undefined || value.length === 0) {
		return "never";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "invalid timestamp";
	}
	const diffMs = Math.max(0, now.getTime() - date.getTime());
	const totalSeconds = Math.floor(diffMs / 1000);
	if (totalSeconds < 60) {
		return `${String(totalSeconds)}s ago`;
	}
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) {
		return `${String(totalMinutes)}m ago`;
	}
	const totalHours = Math.floor(totalMinutes / 60);
	if (totalHours < 24) {
		return `${String(totalHours)}h ago`;
	}
	const totalDays = Math.floor(totalHours / 24);
	return `${String(totalDays)}d ago`;
};

export const slugToTitle = (value: string): string =>
	value
		.split(/[_:-]/g)
		.filter((part) => part.length > 0)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
