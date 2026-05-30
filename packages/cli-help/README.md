# @pdx/cli-help

Shared terminal help renderer for Pandora's Box CLIs.

## Package role

`@pdx/cli-help` renders human `--help` output from the real `@effect/cli` command descriptor tree. It does not define command surfaces and does not own machine-readable `--help-json` output.

Consumers pass their built `Command.Command` plus argv-like args to `renderHelp(...)` before normal CLI dispatch:

```ts
const help = renderHelp(command, process.argv.slice(2));
if (help !== undefined) {
	process.stdout.write(help);
	process.exit(0);
}
```

## Source of truth

Help content is authored on the Effect CLI builders themselves:

- command names and nesting: `Command.make(...)` / `Command.withSubcommands(...)`
- command summaries: `Command.withDescription(...)`
- positional args: `Args.*(...)` / `Args.withDescription(...)`
- flags/options: `Options.*(...)` / `Options.withDescription(...)`
- usage shape: the actual command args/options

This package only owns formatting: section labels, spacing, command-path resolution for help requests, and hiding Effect built-ins from custom terminal help.

## Behavior

`renderHelp(command, args)` returns a string for:

- `--help`
- `-h`
- `help`
- `help <subcommand...>`
- `<subcommand...> --help`

It resolves the deepest matching subcommand from the descriptor tree and ignores positional argument values after the command path, so `pdx run kill run_123 --help` renders `pdx run kill` help.

Returns `undefined` when no help was requested.

## Development

```sh
pnpm --filter @pdx/cli-help test
pnpm --filter @pdx/cli-help typecheck
pnpm --filter @pdx/cli-help lint
```
