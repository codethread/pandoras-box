# @pdx/fagent

Test-only fake Harness CLI for deterministic local and integration tests.

`fagent` is a private bin-only workspace package. Production packages do not depend on it, and it is not globally linked by the project build.

## Usage

```sh
pnpm --filter @pdx/fagent start -- \
  --config ./fagent.json \
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

Scripted mode reads Spawner-provided `PITHOS_RUN_ID` and `PITHOS_SCOPE_ID`, calls the configured repo-local `pithosPath`, and fails loudly when an expected claim or transition is unavailable. Supported MVP actions are `claim`, `enqueue_execute`, `fail_execute_once`, `repair_replay`, and `complete`. `hitl: true` returns `FAGENT_HITL_READY` and the CLI remains resident on stdin after running the script, matching Pandora-style HITL supervision.

The script evidence surface is the append-only JSONL file at `eventLogPath`. Each key action appends one object with `run_id`, `agent_kind`, `action`, `task_id` when known, and `outcome` (`ok` or `error`). Integration tests should assert these events rather than terminal capture.

The builtin `READ X,Y,Z` input reads files relative to the process cwd and prints `READ_RESULT` followed by deterministic `FILE <path>` sections. Malformed config, missing config paths, missing responses, unsupported argv, and unreadable files exit non-zero with clear stderr.

## Development

```sh
pnpm --filter @pdx/fagent test
pnpm --filter @pdx/fagent build
pnpm --filter @pdx/fagent start -- --config ./fagent.json --print ping
```
