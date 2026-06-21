#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="pandoras-box-integration:pdx-open-fagent"

podman build --file "$repo_root/containers/Containerfile.integration" --tag "$image" "$repo_root/containers"

artifact_root="$(mktemp -d -t pdx-open-fagent.XXXXXX)"
set +e
podman run --rm --interactive \
	--volume "$repo_root:/src:ro,Z" \
	--volume "$artifact_root:/artifacts:Z" \
	--workdir / \
	--env PDX_DATA_DIR=/artifacts/data \
	--env PDX_USER_DATA_DIR=/artifacts/user-config \
	--env PITHOS_DB=/artifacts/data/pithos.sqlite \
	--env TMUX_TMPDIR=/artifacts/tmux \
	--env CI=true \
	"$image" \
	bash -euo pipefail <<'INTEGRATION'
trap 'echo integration failed; ls -R "$PDX_DATA_DIR" "$PDX_USER_DATA_DIR" 2>/dev/null || true; [ -f "$PDX_DATA_DIR/pdx.jsonl" ] && tail -200 "$PDX_DATA_DIR/pdx.jsonl" || true; tmux capture-pane -pt pdx--pandora 2>/dev/null || true; tmux capture-pane -pt pdx--daemon 2>/dev/null || true' ERR

mkdir -p /workspace
tar -C /src --exclude=node_modules --exclude=.pnpm-store -cf - . | tar -C /workspace -xf -
cd /workspace

rm -rf "$PDX_DATA_DIR" "$PDX_USER_DATA_DIR" "$TMUX_TMPDIR"
mkdir -p "$PDX_DATA_DIR" "$PDX_USER_DATA_DIR/fagent" "$TMUX_TMPDIR/tmux-0"
chmod 700 "$TMUX_TMPDIR/tmux-0"

export PATH="/workspace/packages/pithos/bin:/workspace/packages/pdx/bin:/workspace/packages/spawner/bin:/workspace/packages/fagent/bin:$PATH"
export FAGENT_EVENTS="$PDX_DATA_DIR/fagent-events.jsonl"
export FAGENT_CONFIG_DIR="$PDX_USER_DATA_DIR/fagent"

pnpm install --frozen-lockfile
pnpm run build

pdx init --data-dir "$PDX_DATA_DIR"
cat > "$PDX_USER_DATA_DIR/supervisor.toml" <<'TOML'
[launch_preconditions]
enforce_repo_root_trunk = false
TOML

repo_scope_id="$(pithos scope upsert --kind repo --path /workspace | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).scope.id))')"

cat > "$FAGENT_CONFIG_DIR/pandora.json" <<'JSON'
{"responses":{"begin":"FAGENT_HITL_READY"}}
JSON
cat > "$FAGENT_CONFIG_DIR/pandora-repair.json" <<JSON
{"scripts":{"repair":{"agentKind":"pandora","capability":"escalate","pithosPath":"/workspace/packages/pithos/bin/pithos","eventLogPath":"$FAGENT_EVENTS","actions":["claim","repair_replay"]}}}
JSON
cat > "$FAGENT_CONFIG_DIR/toil.json" <<JSON
{"scripts":{"Claim and process one task, then exit.":{"agentKind":"toil","capability":"triage","pithosPath":"/workspace/packages/pithos/bin/pithos","eventLogPath":"$FAGENT_EVENTS","executeScopeId":"$repo_scope_id","actions":["claim","enqueue_execute","complete"]}}}
JSON
cat > "$FAGENT_CONFIG_DIR/war-fail.json" <<JSON
{"scripts":{"Claim and process one task, then exit.":{"agentKind":"war","capability":"execute","pithosPath":"/workspace/packages/pithos/bin/pithos","eventLogPath":"$FAGENT_EVENTS","actions":["claim","fail_execute_once"]}}}
JSON
cat > "$FAGENT_CONFIG_DIR/war-done.json" <<JSON
{"scripts":{"Claim and process one task, then exit.":{"agentKind":"war","capability":"execute","pithosPath":"/workspace/packages/pithos/bin/pithos","eventLogPath":"$FAGENT_EVENTS","actions":["claim","complete"]}}}
JSON

cat > "$PDX_USER_DATA_DIR/agents.toml" <<TOML
[agents.pandora.harness]
kind = "fagent"
model = "fake"
system_prompt_mode = "replace"
argv.add = ["/workspace/packages/fagent/bin/fagent", "--config", "$FAGENT_CONFIG_DIR/pandora.json"]

[agents.toil.harness]
kind = "fagent"
model = "fake"
system_prompt_mode = "replace"
argv.add = ["/workspace/packages/fagent/bin/fagent", "--config", "$FAGENT_CONFIG_DIR/toil.json"]

[agents.war.harness]
kind = "fagent"
model = "fake"
system_prompt_mode = "replace"
argv.add = ["/workspace/packages/fagent/bin/fagent", "--config", "$FAGENT_CONFIG_DIR/war-fail.json"]
TOML

pithos run upsert --run run_pandora_seed --agent pandora --mode hitl --scope global --cwd /workspace --harness-kind fagent --session-log-path "$PDX_DATA_DIR/pandora-seed.jsonl" --session-id pandora-seed >/dev/null
pithos task enqueue --run run_pandora_seed --scope global --capability triage --title "fagent integration triage" --stdin --chain none <<'TASK' >/dev/null
Drive the deterministic fagent integration task chain.
TASK

tmux new-session -d -s pdx-integration-prime "sleep 300"
timeout 10s script -q -c "pdx open --data-dir '$PDX_DATA_DIR' --interval-seconds 1 --max-afk 1" /tmp/pdx-open.typescript </dev/null >/tmp/pdx-open.out 2>/tmp/pdx-open.err || true
if ! tmux has-session -t pdx--daemon 2>/dev/null; then
	cat /tmp/pdx-open.out /tmp/pdx-open.err >&2 || true
	exit 1
fi

tmux list-sessions | tee "$PDX_DATA_DIR/tmux-open.txt"
tmux has-session -t pdx--daemon
tmux has-session -t pdx--pandora

node <<'NODE'
const fs = require('node:fs');
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  const text = fs.existsSync(process.env.FAGENT_EVENTS) ? fs.readFileSync(process.env.FAGENT_EVENTS, 'utf8') : '';
  if (text.includes('"action":"fail_execute_once"')) process.exit(0);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
}
throw new Error('war first failure was not observed');
NODE

sed -i 's/war-fail\.json/war-done.json/' "$PDX_USER_DATA_DIR/agents.toml"
pandora_run_id="$(sqlite3 "$PITHOS_DB" "select id from runs where agent_kind='pandora' and status='live' order by created_at desc limit 1")"
tmux respawn-pane -k -t pdx--pandora "PITHOS_DB='$PITHOS_DB' PDX_USER_DATA_DIR='$PDX_USER_DATA_DIR' PITHOS_RUN_ID='$pandora_run_id' PITHOS_SCOPE_ID='global' /workspace/packages/fagent/bin/fagent --config '$FAGENT_CONFIG_DIR/pandora-repair.json' --print repair; tail -f /dev/null"

node <<'NODE'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const expected = ['claim','enqueue_execute','complete','claim','fail_execute_once','claim','repair_replay','claim','complete'];
const deadline = Date.now() + 90000;
let events = [];
while (Date.now() < deadline) {
  const text = fs.existsSync(process.env.FAGENT_EVENTS) ? fs.readFileSync(process.env.FAGENT_EVENTS, 'utf8').trim() : '';
  events = text ? text.split('\n').map((line) => JSON.parse(line)) : [];
  const actions = events.map((event) => event.action);
  if (expected.every((action, index) => actions[index] === action)) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
}
const actions = events.map((event) => event.action);
if (!expected.every((action, index) => actions[index] === action)) throw new Error(`fagent milestones not reached: ${JSON.stringify(actions)}`);
if (!events.every((event) => event.outcome === 'ok')) throw new Error(`fagent error event: ${JSON.stringify(events)}`);

const graph = spawnSync('/workspace/packages/pithos/bin/pithos', ['graph', 'inspect', '--all', '--json'], { encoding: 'utf8', env: process.env });
if (graph.status !== 0) throw new Error(graph.stderr || graph.stdout);
fs.writeFileSync(`${process.env.PDX_DATA_DIR}/graph-final.json`, graph.stdout);
const rows = spawnSync('sqlite3', [process.env.PITHOS_DB, 'select capability || char(9) || status from tasks'], { encoding: 'utf8' });
if (rows.status !== 0) throw new Error(rows.stderr || rows.stdout);
const statuses = rows.stdout.trim().split('\n').filter(Boolean).map((line) => line.split('\t'));
for (const [capability, status] of [['triage', 'done'], ['execute', 'done'], ['escalate', 'done']]) {
  if (!statuses.some(([actualCapability, actualStatus]) => actualCapability === capability && actualStatus === status)) throw new Error(`missing terminal ${capability}/${status}: ${JSON.stringify(statuses)}`);
}
NODE

pdx close --data-dir "$PDX_DATA_DIR"
if tmux has-session -t pdx--daemon 2>/dev/null || tmux has-session -t pdx--pandora 2>/dev/null; then
	echo "pdx-owned tmux session still exists after close" >&2
	exit 1
fi

tmux kill-session -t pdx-integration-prime 2>/dev/null || true

echo "pdx open fagent integration ok"
INTEGRATION
status=$?
set -e
if [ "$status" -eq 0 ]; then
	rm -rf "$artifact_root" 2>/dev/null || true
else
	echo "pdx open fagent integration artifacts preserved at $artifact_root" >&2
fi
exit "$status"
