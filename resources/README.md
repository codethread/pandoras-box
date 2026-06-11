# Resources

Repo-root seed resources for Pandora's Box.

Source buckets mirror install destinations:

```text
resources/
  data-dir/       # re-seeded into <data-dir>
  user-data-dir/  # scaffolded/re-seeded into <user-data-dir>
```

## Ownership

`resources/data-dir/` contains bundle-owned runtime defaults. `pdx init` and
`pdx open` re-seed these files into `<data-dir>`:

- `agents.toml` — canonical bundled Agent prompt defaults; Harness runtimes are user-configured
- `templates/agents/*.md` — bundled Agent prompts
- `templates/common/*.md` — bundled shared prompt fragments
- `AGENTS.md` — minimal data-dir runtime note

`resources/user-data-dir/` contains user-config scaffolds and the installed user
reference. `pdx` scaffolds missing user files once, except `PANDORA.md`, which is
re-seeded on `init` / `open`:

- `AGENTS.md` — direct-agent pointer
- `CLAUDE.md` — Claude direct-agent pointer
- `agents.toml` — user policy registry starter
- `artifacts.toml` — user-owned Artifact Contract starter with commented examples only
- `PANDORA.md` — user-facing config reference

## Documentation boundary

The durable system contract lives in specs, especially
[`specs/agent-configuration.md`](../specs/agent-configuration.md). The
user-facing machine-local configuration guide is
[`resources/user-data-dir/PANDORA.md`](./user-data-dir/PANDORA.md).

Do not duplicate the policy registry, external intake, prompt-composition, or
lifecycle contract here; update the spec and `PANDORA.md` instead.

## Lifecycle flags

- `pdx init` / `pdx open` — re-seed bundled `<data-dir>/agents.toml`,
  `<data-dir>/templates/`, and `<data-dir>/AGENTS.md`; scaffold missing
  `<user-data-dir>/AGENTS.md`, `<user-data-dir>/CLAUDE.md`,
  `<user-data-dir>/agents.toml`, and `<user-data-dir>/artifacts.toml`;
  re-seed installed `<user-data-dir>/PANDORA.md`.
- `--clean` — wipe runtime state only: db, runs, logs. Keep bundled config and
  user config.
- `--nuke` — wipe pdx-owned runtime/bundled state while preserving
  `<user-data-dir>`, then re-seed fresh canonicals.
- `--clean` and `--nuke` are mutually exclusive.
