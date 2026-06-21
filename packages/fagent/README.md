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

Config is JSON with exact input/response mappings:

```json
{
	"responses": {
		"ping": "pong"
	}
}
```

The builtin `READ X,Y,Z` input reads files relative to the process cwd and prints `READ_RESULT` followed by deterministic `FILE <path>` sections. Malformed config, missing config paths, missing responses, unsupported argv, and unreadable files exit non-zero with clear stderr.

## Development

```sh
pnpm --filter @pdx/fagent test
pnpm --filter @pdx/fagent build
pnpm --filter @pdx/fagent start -- --config ./fagent.json --print ping
```
