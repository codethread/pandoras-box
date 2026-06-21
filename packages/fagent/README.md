# @pdx/fagent

Test-only fake Harness CLI for deterministic local and Podman integration tests.

`fagent` is a private bin-only workspace package for deterministic tests. Production packages do not depend on it, and it is not globally linked by the project build.

## Usage

```sh
pnpm --filter @pdx/fagent start --config ./fagent.json \
  --session-id demo \
  --model fake \
  --system-prompt "prompt" \
  --print ping
```

Config is JSON with exact input/response mappings and optional deterministic scripts keyed by startup input:

```json
{
	"responses": {
		"ping": "pong"
	},
	"scripts": {
		"toil": {
			"agentKind": "toil",
			"capability": "triage",
			"pithosPath": "./packages/pithos/bin/pithos",
			"eventLogPath": "/tmp/pdx/fagent-events.jsonl",
			"executeScopeId": "repo:/repo/path",
			"actions": ["claim", "enqueue_execute", "complete"]
		}
	}
}
```

Scripted mode reads Spawner-provided `PITHOS_RUN_ID` and `PITHOS_SCOPE_ID`, calls the configured repo-local `pithosPath`, and fails loudly when an expected claim or transition is unavailable. Supported MVP actions are `claim`, `enqueue_execute`, `fail_execute_once`, `repair_replay`, and `complete`. `hitl: true` returns `FAGENT_HITL_READY`, records a `hitl_startup` event, and keeps the original CLI process resident on stdin. Later newline-delimited stdin inputs are matched against the same configured response/script keys, so entries such as `repair` can run scripted Pithos actions inside the pdx-launched Pandora-style HITL process. AFK `--print` inputs still run once and exit.

The script evidence surface is the append-only JSONL file at `eventLogPath`. Each key action appends one object with `run_id`, `agent_kind`, `action`, `task_id` when known, and `outcome` (`ok` or `error`). CLI-driven events also include stable `instance_id` and `process_id` values so tests can prove stdin-triggered HITL actions happened in the startup process. Integration tests should assert these events rather than terminal capture.

The builtin `READ X,Y,Z` input reads files relative to the process cwd and prints `READ_RESULT` followed by deterministic `FILE <path>` sections. Malformed config, missing config paths, missing responses, unsupported argv, and unreadable files exit non-zero with clear stderr.

## Integration-test use

Podman integration config selects `fagent` from `<user-data-dir>/agents.toml` with explicit repo-local binary paths such as `/workspace/packages/fagent/bin/fagent`. The `pdx open` integration writes fake-Harness evidence to `$PDX_DATA_DIR/fagent-events.jsonl` and preserves the host artifact directory on failure.

Run package checks while editing `fagent`:

```sh
pnpm --filter @pdx/fagent test
pnpm --filter @pdx/fagent build
pnpm --filter @pdx/fagent start --config ./fagent.json --print ping
```

Run the full Podman-backed flow with:

```sh
pnpm run test:integration:pdx-open-fagent
```
