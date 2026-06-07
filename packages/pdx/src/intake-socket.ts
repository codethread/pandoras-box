import { Effect, ParseResult, Schema } from "effect";
import { rm } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { PDX_SYSTEM_RUN_ID } from "@pdx/pithos";
import { PdxError } from "./errors.js";
import type { PithosClientService } from "./services.js";

export interface IntakeServerHandle {
	readonly close: Effect.Effect<void, PdxError>;
}

export interface IntakeResponse {
	readonly ok: boolean;
	readonly data?: { readonly enqueued: 1 };
	readonly error?: string;
}

const IntakeEventSchema = Schema.Struct({
	title: Schema.NonEmptyString,
	body: Schema.NonEmptyString,
});
export type IntakeEvent = Schema.Schema.Type<typeof IntakeEventSchema>;

const unlinkSocket = (socketPath: string) =>
	Effect.tryPromise({
		try: () => rm(socketPath, { force: true }),
		catch: (error) =>
			new PdxError({ code: "IPC_ERROR", message: `Intake socket unlink failed: ${String(error)}` }),
	}).pipe(Effect.asVoid);

const parseJson = (input: string): Effect.Effect<unknown, PdxError> =>
	Effect.try({
		try: () => JSON.parse(input) as unknown,
		catch: (cause) =>
			new PdxError({ code: "IPC_ERROR", message: `Malformed intake JSON: ${String(cause)}` }),
	});

export const parseIntakeEvent = (input: string): Effect.Effect<IntakeEvent, PdxError> =>
	parseJson(input).pipe(
		Effect.flatMap((value) =>
			Schema.decodeUnknown(IntakeEventSchema)(value, { errors: "all" }).pipe(
				Effect.mapError(
					(error) =>
						new PdxError({
							code: "IPC_ERROR",
							message: `Invalid intake event: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
						}),
				),
			),
		),
	);

const parseIntakeRequest = (input: string): Effect.Effect<IntakeEvent, PdxError> => {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return Effect.fail(new PdxError({ code: "IPC_ERROR", message: "No intake event provided" }));
	}
	return parseIntakeEvent(trimmed);
};

const responseForError = (error: unknown): IntakeResponse =>
	error instanceof PdxError
		? { ok: false, error: `${error.code}: ${error.message}` }
		: { ok: false, error: `IPC_ERROR: ${String(error)}` };

const enqueueIntakeEvent = (pithos: PithosClientService, event: IntakeEvent) =>
	pithos.taskEnqueue({
		scope: "global",
		capability: "intake",
		title: event.title,
		body: event.body,
		runId: PDX_SYSTEM_RUN_ID,
	});

export const listenIntakeSocket = (
	socketPath: string,
	pithos: PithosClientService,
): Effect.Effect<IntakeServerHandle, PdxError> =>
	unlinkSocket(socketPath).pipe(
		Effect.zipRight(
			Effect.async<IntakeServerHandle, PdxError>((resume) => {
				const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
					let input = "";
					socket.setEncoding("utf8");
					socket.on("data", (chunk: string) => {
						input += chunk;
					});
					socket.on("end", () => {
						const response = parseIntakeRequest(input).pipe(
							Effect.flatMap((event) =>
								enqueueIntakeEvent(pithos, event).pipe(
									Effect.as({ ok: true, data: { enqueued: 1 } } satisfies IntakeResponse),
								),
							),
							Effect.catchAll((error) => Effect.succeed(responseForError(error))),
						);
						Effect.runPromise(response)
							.then((value) => socket.end(`${JSON.stringify(value)}\n`))
							.catch((cause: unknown) =>
								socket.end(`${JSON.stringify(responseForError(cause))}\n`),
							);
					});
				});
				server.once("error", (error) => {
					resume(
						Effect.fail(
							new PdxError({
								code: "IPC_ERROR",
								message: `Intake socket listen failed: ${error.message}`,
							}),
						),
					);
				});
				server.listen(socketPath, () => {
					resume(
						Effect.succeed({
							close: Effect.async((closeResume) => {
								server.close((error) => {
									closeResume(
										error === undefined
											? unlinkSocket(socketPath)
											: Effect.fail(
													new PdxError({
														code: "IPC_ERROR",
														message: `Intake socket close failed: ${error.message}`,
													}),
												),
									);
								});
							}),
						}),
					);
				});
			}),
		),
	);

export const requestIntake = (
	socketPath: string,
	input: string,
): Effect.Effect<IntakeResponse, PdxError> =>
	Effect.async((resume) => {
		const socket = createConnection(socketPath);
		let output = "";
		socket.setEncoding("utf8");
		socket.once("error", (error) => {
			resume(
				Effect.fail(
					new PdxError({ code: "IPC_ERROR", message: `Intake request failed: ${error.message}` }),
				),
			);
		});
		socket.on("data", (chunk: string) => {
			output += chunk;
		});
		socket.on("end", () => {
			resume(parseJson(output).pipe(Effect.map((value) => value as IntakeResponse)));
		});
		socket.end(input);
	});
