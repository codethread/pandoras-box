#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

podman build \
	--file "$repo_root/containers/Containerfile.integration" \
	--tag pandoras-box-integration:tmux \
	"$repo_root/containers"

podman run --rm \
	--volume "$repo_root:/workspace:Z" \
	--workdir /workspace \
	--env PDX_DATA_DIR=/tmp/pdx-integration/data \
	--env PDX_USER_DATA_DIR=/tmp/pdx-integration/user-config \
	--env PITHOS_DB=/tmp/pdx-integration/data/pithos.sqlite \
	--env TMUX_TMPDIR=/tmp/pdx-integration/tmux \
	pandoras-box-integration:tmux \
	bash -euo pipefail -c '
		mkdir -p "$PDX_DATA_DIR" "$PDX_USER_DATA_DIR" "$TMUX_TMPDIR"
		session="pdx-container-smoke-$$"
		tmux -S "$TMUX_TMPDIR/pdx-smoke.sock" new-session -d -s "$session" "sleep 60"
		tmux -S "$TMUX_TMPDIR/pdx-smoke.sock" list-sessions | grep -F "$session"
		tmux -S "$TMUX_TMPDIR/pdx-smoke.sock" kill-session -t "$session"
		echo "podman tmux smoke ok"
	'
