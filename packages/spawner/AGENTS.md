# @pdx/spawner agent notes

Launcher-only package for rendering and launching Pandora's Box agent harness sessions.

## Shape

- Bin: `pandora-spawn`
- CLI surface: `pandora-spawn preview ...` only
- Library surface: `renderAgent(input)`, `launchRenderedAgent(rendered)`, `launchAgent(input)`, `renderSessionTranscript(input)`, `LiveSpawnerServices`, `makeFakeSpawnerServices`
- Config API: bundled prompt defaults come from `resources/data-dir/agents.toml` plus `resources/data-dir/templates/`; render reads only bundled defaults plus optional `$PDX_USER_DATA_DIR/agents.toml` for Harness settings, policy packs/rules, and hooks. User/project `template`, `includes`, `appends`, same-path `templates/`, scope directories, hooks inside rules, and project-local `.pdx` manifests are not prompt or hook customization surfaces.

## Manual test

```sh
pnpm --filter @pdx/spawner start -- preview --agent war --mode afk --scope scope_repo --run run_demo --session-id 123e4567-e89b-12d3-a456-426614174000 --cwd "$PWD" | jq .
```

With built/link bin:

```sh
pnpm run build
pandora-spawn preview --agent war --mode afk --scope scope_repo --run run_demo --session-id 123e4567-e89b-12d3-a456-426614174000 --cwd "$PWD" | jq .
```
