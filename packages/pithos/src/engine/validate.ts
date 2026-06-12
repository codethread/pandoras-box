import { Effect, Either, Schema } from "effect";
import type { HarnessKind } from "../db.js";
import { fail } from "../errors.js";
import type { EngineContext } from "./types.js";

const HarnessKindSchema = Schema.Literal("claude", "pi", "system");

export const parseHarnessKind = (value: unknown): HarnessKind =>
	Either.match(Schema.decodeUnknownEither(HarnessKindSchema)(value), {
		onLeft: () =>
			fail(
				"VALIDATION_ERROR",
				`invalid --harness-kind: ${String(value)}. Valid values: claude, pi, system`,
			),
		onRight: (kind) => kind,
	});

export const requireNonEmpty = (value: string, name: string): string => {
	if (value.length === 0) fail("VALIDATION_ERROR", `${name} must be non-empty`);
	return value;
};

export const resolveRunId = (ctx: EngineContext, explicit: string | undefined): string => {
	const env = ctx.config.runId;
	if (explicit !== undefined && env !== undefined && explicit !== env) {
		fail("VALIDATION_ERROR", "--run conflicts with PITHOS_RUN_ID");
	}
	return requireNonEmpty(explicit ?? env ?? fail("VALIDATION_ERROR", "missing --run"), "--run");
};

export const resolveBody = (
	ctx: EngineContext,
	body: string | undefined,
	bodyFile: string | undefined,
): string => {
	if (body !== undefined && bodyFile !== undefined) {
		fail("VALIDATION_ERROR", "provide only one of --body or --body-file");
	}
	const value =
		body ??
		(bodyFile === undefined ? undefined : Effect.runSync(ctx.services.fs.readText(bodyFile)));
	return requireNonEmpty(
		value ?? fail("VALIDATION_ERROR", "missing --body or --body-file"),
		"body",
	);
};
