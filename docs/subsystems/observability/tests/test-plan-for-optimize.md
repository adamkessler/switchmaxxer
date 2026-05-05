# Test Plan for Optimize

This plan starts with two manual dogfood cases for `smx optimize`.

- Test Case 0 is a short disposable-fixture pass for Ledger coherence. It uses
  `config-examples/config.example.json` and `config-examples/catalog.example.json`, does not touch the real
  catalog, and verifies the relationship between `control_plane_action_events`,
  `config_mutation_events`, and optimize JSON envelopes.
- Test Case 1 is a live end-to-end pass from gateway readiness, through a
  latency optimize run, through dry-run apply, through real provider mutation and
  gateway validation.

## Test Case 0: Short Ledger dogfood with example fixtures

### Goal

Prove that optimize apply/restore attempts create coherent audit evidence:

- every apply/restore attempt is represented in `control_plane_action_events`
- committed effective mutations are represented in `config_mutation_events`
- failed, dry-run, and no-op attempts do not create fake restore points
- restore actions link back to the original apply through
  `config_mutation_events.parent_event_id`

### Prep

Use disposable files:

```bash
cd /home/adam-kessler/dev/switchmaxxer
tmp="$(mktemp -d)"
cp config-examples/config.example.json "$tmp/config.json"
cp config-examples/catalog.example.json "$tmp/catalog.json"
chmod 600 "$tmp/config.json" "$tmp/catalog.json"
export SWITCHMAXXER_OBSERVABILITY_DB="$tmp/observability.sqlite"
export SWITCHMAXXER_INBOUND_API_KEY="${SWITCHMAXXER_INBOUND_API_KEY:-switchmaxxer-dogfood-placeholder-123456}"
```

The example config requires `SWITCHMAXXER_INBOUND_API_KEY` for real config
mutation validation. The placeholder above is long enough for local dogfood; use
a real secret only when intentionally testing a live gateway.

Check starting providers:

```bash
jq '.routes["gpt-4o-mini"].service_provider,
    .routes["openrouter-gpt-4o-mini"].service_provider' "$tmp/catalog.json"
```

Expected result:

```text
"openai_direct"
"openrouter"
```

### Step 1: Create a cost optimize run

```bash
smx optimize --config "$tmp/config.json" --model gpt-4o-mini --objective cost --json \
  | tee "$tmp/optimize-cost.json"

RUN_ID="$(jq -r '.data.run.run_id' "$tmp/optimize-cost.json")"
WINNER_ROUTE="$(jq -r '.data.winner.route_id' "$tmp/optimize-cost.json")"
WINNER_PROVIDER="$(jq -r --arg route "$WINNER_ROUTE" \
  '.data.ranking[] | select(.route_id == $route) | .service_provider' \
  "$tmp/optimize-cost.json")"
printf 'run=%s\nwinner_route=%s\nwinner_provider=%s\n' \
  "$RUN_ID" "$WINNER_ROUTE" "$WINNER_PROVIDER"
```

Expected result for the current example fixture:

- `WINNER_ROUTE` is `gpt-4o-mini`
- `WINNER_PROVIDER` is `openai_direct`

The current example fixture has a cost tie between `gpt-4o-mini` and
`openrouter-gpt-4o-mini`; the stable tiebreaker selects `gpt-4o-mini`.

### Step 2: Dry-run apply against a different same-model route

Do not mutate the catalog after creating the optimize run to force drift; apply
correctly rejects stale winner routes. To produce a real provider diff, apply
the winner's provider to a different route that targets the same model:

```bash
TARGET_ROUTE="openrouter-gpt-4o-mini"

smx optimize apply "$RUN_ID" --route "$TARGET_ROUTE" --config "$tmp/config.json" --dry-run --json \
  | tee "$tmp/apply-dry-run.json"
```

Expected result:

- `.data.dry_run` is `true`
- `.data.changed` is `true`
- `.data.action_id` is `null`
- the catalog is still unchanged
- the latest Ledger row is `optimize_apply / dry_run_succeeded`
- Ledger `mutation_event_id` is `NULL`

Inspect the Ledger:

```bash
sqlite3 "$tmp/observability.sqlite" '
.headers on
.mode column
select operation, status, target_id, optimization_run_id, mutation_event_id
from control_plane_action_events
order by created_at desc, id desc
limit 3;
'
```

### Step 3: Apply for real

```bash
smx optimize apply "$RUN_ID" --route "$TARGET_ROUTE" --config "$tmp/config.json" --json \
  | tee "$tmp/apply-real.json"

APPLY_ACTION_ID="$(jq -r '.data.action_id' "$tmp/apply-real.json")"
```

Expected result:

- `.data.changed` is `true`
- `.data.action_id` is a non-empty string
- `catalog.json` route `openrouter-gpt-4o-mini` now uses `openai_direct`
- the latest Ledger row is `optimize_apply / succeeded`
- Ledger `mutation_event_id` equals `APPLY_ACTION_ID`
- `config_mutation_events.id` has the same value as `APPLY_ACTION_ID`

### Step 4: Re-run apply to verify no-op semantics

```bash
smx optimize apply "$RUN_ID" --route "$TARGET_ROUTE" --config "$tmp/config.json" --json \
  | tee "$tmp/apply-noop.json"
```

Expected result:

- `.data.changed` is `false`
- `.data.action_id` is `null`
- the latest Ledger row is `optimize_apply / noop`
- no new `config_mutation_events` row is created

### Step 5: Dry-run restore

```bash
smx optimize restore "$APPLY_ACTION_ID" --config "$tmp/config.json" --dry-run --json \
  | tee "$tmp/restore-dry-run.json"
```

Expected result:

- `.data.dry_run` is `true`
- `.data.changed` is `true`
- the catalog is still unchanged
- the latest Ledger row is `optimize_restore / dry_run_succeeded`
- Ledger `target_id` is `openrouter-gpt-4o-mini`
- Ledger `optimization_run_id` is `RUN_ID`
- Ledger `mutation_event_id` is `NULL`

### Step 6: Restore for real

```bash
smx optimize restore "$APPLY_ACTION_ID" --config "$tmp/config.json" --json \
  | tee "$tmp/restore-real.json"

RESTORE_ACTION_ID="$(jq -r '.data.action_id' "$tmp/restore-real.json")"
```

Expected result:

- route `openrouter-gpt-4o-mini` returns to provider `openrouter`
- the latest Ledger row is `optimize_restore / succeeded`
- Ledger `target_id` is `openrouter-gpt-4o-mini`
- Ledger `optimization_run_id` is `RUN_ID`
- Ledger `mutation_event_id` equals `RESTORE_ACTION_ID`
- the restore mutation row has `parent_event_id = APPLY_ACTION_ID`

Inspect the chain:

```bash
sqlite3 "$tmp/observability.sqlite" '
.headers on
.mode column
select id, operation, status, target_id, optimization_run_id, mutation_event_id
from control_plane_action_events
order by created_at desc, id desc
limit 10;

select id, operation, status, target_id, optimization_run_id, parent_event_id
from config_mutation_events
order by created_at desc, id desc
limit 10;
'
```

### Step 7: Failure case

```bash
smx optimize apply "$RUN_ID" --route does-not-exist --config "$tmp/config.json" --json
```

Expected result:

- the command exits nonzero
- the JSON error code is `route_not_found`
- the latest Ledger row is `optimize_apply / failed`
- Ledger `target_id` is `does-not-exist`
- `error_json` contains `schema_version`, `code`, `message`, and `details`
- no new `config_mutation_events` row is created

### Cleanup

```bash
rm -rf "$tmp"
```

## Test Case 1: Apply the latency winner for `gpt-4o-mini`

### Goal

Prove that `smx optimize` can find the fastest configured provider route for
`gpt-4o-mini`, then safely apply that winner to the existing named route
`gpt-4o-mini`.

### Test Data

Use the repository root as the working directory:

```bash
cd /home/adam-kessler/dev/switchmaxxer
```

| Field | Value |
| --- | --- |
| Config file | `config.json` |
| Catalog file | `catalog.json` |
| Gateway host | `127.0.0.1` |
| Gateway port | `4080` |
| Gateway systemd unit | `switchmaxxer.service` |
| Target model | `gpt-4o-mini` |
| Route to mutate | `gpt-4o-mini` |
| Required initial provider | `openai_direct` |
| Expected winning provider | `openrouter` |
| Objective | `latency` |
| Prompt | `Say pong` |
| Iterations | `5` |

Candidate routes currently present for this model:

| Route | Provider | Provider model id |
| --- | --- | --- |
| `gpt-4o-mini` | `openai_direct` | `gpt-4o-mini` |
| `gpt-4o-mini-direct` | `openai_direct` | `gpt-4o-mini` |
| `openrouter-gpt-4o-mini` | `openrouter` | `openai/gpt-4o-mini` |
| `gpt-4o-mini-via-openrouter` | `openrouter` | `openai/gpt-4o-mini` |

Required credentials:

```bash
test -n "$SWITCHMAXXER_OPENAI_API_KEY"
test -n "$SWITCHMAXXER_OPENROUTER_API_KEY"
```

If the gateway is configured to require inbound auth, also make sure the
required inbound gateway key is available in your shell. The example config uses
`SWITCHMAXXER_INBOUND_API_KEY`, and real apply/restore validation requires that
value to be at least 32 characters long.

### Step 1: Reload or restart the gateway

Try a runtime reload first:

```bash
smx gateway reload --config ./config.json --json
```

If reload cannot reach the runtime endpoint, restart the service:

```bash
smx gateway restart --json
```

Check health after the reload or restart:

```bash
smx gateway health --check all --json
```

Expected result:

- The command returns JSON with `"ok": true`.
- The overall health status is `pass`.
- The config check reports `config.json`.

### Step 2: Check the initial route state

The target route should start on the non-optimal provider, `openai_direct`.

```bash
smx routes show gpt-4o-mini --json \
  | jq '.data | {
      route: .name,
      model: .model,
      service_provider: .service_provider,
      api_mode: .api_mode,
      provider_model_id: .provider_model_id
    }'
```

Expected result:

```json
{
  "route": "gpt-4o-mini",
  "model": "gpt-4o-mini",
  "service_provider": "openai_direct",
  "api_mode": "openai-completions",
  "provider_model_id": "gpt-4o-mini"
}
```

If `service_provider` is already `openrouter`, reset the test fixture before
continuing:

```bash
smx routes update gpt-4o-mini --service-provider openai_direct --json
smx gateway reload --config ./config.json --json || smx gateway restart --json
```

### Step 3: Run optimize

Run a latency optimization for the model:

```bash
smx optimize \
  --model gpt-4o-mini \
  --objective latency \
  --prompt 'Say pong' \
  --iterations 5 \
  --json \
  | tee /tmp/smx-optimize-gpt-4o-mini.json
```

Capture the run id, winner route, and winner provider:

```bash
RUN_ID="$(jq -r '.data.run.run_id' /tmp/smx-optimize-gpt-4o-mini.json)"
STORE_PATH="$(jq -r '.data.store_path' /tmp/smx-optimize-gpt-4o-mini.json)"
WINNER_ROUTE="$(jq -r '.data.winner.route_id' /tmp/smx-optimize-gpt-4o-mini.json)"
WINNER_PROVIDER="$(jq -r --arg route "$WINNER_ROUTE" \
  '.data.ranking[] | select(.route_id == $route) | .service_provider' \
  /tmp/smx-optimize-gpt-4o-mini.json)"

printf 'run=%s\nstore=%s\nwinner_route=%s\nwinner_provider=%s\n' \
  "$RUN_ID" "$STORE_PATH" "$WINNER_ROUTE" "$WINNER_PROVIDER"
```

Expected result:

- `RUN_ID` is a UUID.
- `WINNER_ROUTE` is usually `gpt-4o-mini-via-openrouter` or
  `openrouter-gpt-4o-mini`.
- `WINNER_PROVIDER` is `openrouter`.
- The report includes successful latency samples for every ranked route.

If `WINNER_PROVIDER` is not `openrouter`, stop here. Latency optimization is
based on live measurements, so the fastest provider can change from run to run.
This test case is specifically validating an `openai_direct` to `openrouter`
provider mutation.

### Step 4: Dry-run the apply

Use the persisted optimize run to preview the provider mutation:

```bash
smx optimize apply "$RUN_ID" \
  --route gpt-4o-mini \
  --dry-run \
  --json \
  | tee /tmp/smx-optimize-apply-dry-run.json
```

Inspect the result:

```bash
jq '.data | {
    dry_run: .dry_run,
    changed: .changed,
    mutation: .mutation,
    before: .before,
    after: .after,
    snapshot: .snapshot,
    reload: .reload,
    verification: .verification
  }' /tmp/smx-optimize-apply-dry-run.json
```

Expected result:

- `dry_run` is `true`.
- `changed` is `true`.
- The mutation changes `service_provider` from `openai_direct` to `openrouter`.
- `before.service_provider` is `openai_direct`.
- `after.service_provider` is `openrouter`.
- No managed snapshot is written during the dry run.
- No reload or verification is attempted during the dry run.

### Step 5: Confirm the runtime config is unmutated after dry run

Check the catalog-backed route state again:

```bash
smx routes show gpt-4o-mini --json \
  | jq -r '.data.service_provider'
```

Expected result:

```text
openai_direct
```

Check the gateway runtime config too:

```bash
smx gateway runtime config --json \
  | tee /tmp/smx-runtime-before-apply.json
```

Then inspect the route from the runtime payload:

```bash
jq -r '
  .data.routes[]
  | select(.name == "gpt-4o-mini")
  | .service_provider
' /tmp/smx-runtime-before-apply.json
```

Expected result:

```text
openai_direct
```

If the runtime config payload shape changes, manually find the `gpt-4o-mini`
route in `/tmp/smx-runtime-before-apply.json` and confirm it still points to
`openai_direct`.

### Step 6: Apply for real

Apply the winning provider, reload the gateway, and verify the route:

```bash
smx optimize apply "$RUN_ID" \
  --route gpt-4o-mini \
  --reload \
  --verify \
  --json \
  | tee /tmp/smx-optimize-apply-real.json
```

If the command exits nonzero, still inspect the JSON output. The provider
mutation may have succeeded while reload or verification failed.

Expected result:

- `dry_run` is `false`.
- `changed` is `true`.
- The mutation changes `service_provider` from `openai_direct` to `openrouter`.
- A managed pre-apply snapshot is written to the observability store.
- `action_id` is present. This is the apply action id used for restore.
- Reload succeeds.
- Verification passes.

### Step 7: Check that real apply worked

Inspect the apply output:

```bash
jq '.data | {
    action_id: .action_id,
    changed: .changed,
    mutation: .mutation,
    snapshot: .snapshot,
    reload: .reload,
    verification: .verification
  }' /tmp/smx-optimize-apply-real.json
```

Capture the apply action id and confirm the managed snapshot/event rows exist:

```bash
APPLY_ACTION_ID="$(jq -r '.data.action_id' /tmp/smx-optimize-apply-real.json)"
APPLY_SNAPSHOT_ID="$(jq -r '.data.snapshot.snapshot_id' /tmp/smx-optimize-apply-real.json)"

sqlite3 "$STORE_PATH" \
  "select operation, target_id, snapshot_id from config_mutation_events where id = '$APPLY_ACTION_ID';"

sqlite3 "$STORE_PATH" \
  "select source_kind, source_path, content_bytes from config_snapshots where id = '$APPLY_SNAPSHOT_ID';"
```

Expected result:

- The mutation event has `operation = optimize_apply`.
- The mutation event `snapshot_id` matches `APPLY_SNAPSHOT_ID`.
- The snapshot has `source_kind = catalog` and nonzero `content_bytes`.
- The apply output shows `service_provider` changed to `openrouter`.

### Step 8: Check that the route provider is mutated

Check the route after real apply:

```bash
smx routes show gpt-4o-mini --json \
  | tee /tmp/smx-route-after-apply.json
```

Inspect the applied provider:

```bash
jq '.data | {
    route: .name,
    model: .model,
    service_provider: .service_provider,
    api_mode: .api_mode,
    provider_model_id: .provider_model_id
  }' /tmp/smx-route-after-apply.json
```

Expected result:

```json
{
  "route": "gpt-4o-mini",
  "model": "gpt-4o-mini",
  "service_provider": "openrouter",
  "api_mode": "openai-completions",
  "provider_model_id": "gpt-4o-mini"
}
```

The important assertion is `service_provider: "openrouter"`. Provider-specific
gateway behavior now comes from the selected `openrouter` provider definition.

### Step 9: Check server health, status, and route behavior

Run health and status:

```bash
smx gateway health --check all --json
smx gateway status --json
```

Run a direct route test through the gateway:

```bash
smx test --route gpt-4o-mini --json
```

Expected result:

- Gateway health is still passing.
- Gateway status shows the service is reachable.
- `smx test --route gpt-4o-mini --json` passes.

### Step 10: Restore the apply

Preview the restore first:

```bash
smx optimize restore "$APPLY_ACTION_ID" \
  --dry-run \
  --json \
  | tee /tmp/smx-optimize-restore-dry-run.json
```

Inspect the preview:

```bash
jq '.data | {
    dry_run: .dry_run,
    changed: .changed,
    restore_point: .restore_point,
    mutation: .mutation,
    before: .before,
    after: .after
  }' /tmp/smx-optimize-restore-dry-run.json
```

Expected result:

- `dry_run` is `true`.
- `changed` is `true`.
- `restore_point.operation` is `optimize_apply`.
- `restore_point.action_id` matches `APPLY_ACTION_ID`.
- The mutation changes `service_provider` from `openrouter` back to
  `openai_direct`.

Confirm dry-run did not restore the route yet:

```bash
smx routes show gpt-4o-mini --json | jq -r '.data.service_provider'
```

Expected result:

```text
openrouter
```

Run the real restore:

```bash
smx optimize restore "$APPLY_ACTION_ID" \
  --reload \
  --verify \
  --json \
  | tee /tmp/smx-optimize-restore-real.json
```

Expected result:

- `dry_run` is `false`.
- `changed` is `true`.
- A new managed pre-restore snapshot and restore action event are written to
  the observability store.
- Reload succeeds.
- Verification passes.

Check that the route is back on the original provider:

```bash
smx routes show gpt-4o-mini --json | jq -r '.data.service_provider'
```

Expected result:

```text
openai_direct
```

### Step 11: Exercise optimize-history cleanup

Run these only after the apply has been restored. They mutate optimize-history
in the observability store, not `catalog.json`. They are narrower than
whole-store prune: do not use `smx prune` in this test unless you intend to
clean traces, benchmark rows, facts, mutation events, and snapshots together.

Prune old optimize-history by age:

```bash
smx optimize prune --older-than 30d --json \
  | tee /tmp/smx-optimize-prune.json
```

Expected result:

- The command returns `"ok": true`.
- `.data.scope` is `"older_than"`.
- `.data.older_than` is `"30d"`.
- `.data.result.total_deleted` is a number. It may be `0` if the dev store has
  no optimize runs older than 30 days.
- Trace rows and benchmark rows are not deleted by this command.

Delete the run created by this test:

```bash
smx optimize delete "$RUN_ID" --json \
  | tee /tmp/smx-optimize-delete.json
```

Expected result:

- The command returns `"ok": true`.
- `.data.scope` matches `RUN_ID`.
- `.data.result.optimization_runs_deleted` is `1`.
- Matching optimize-owned committed mutation records and orphaned managed
  snapshots for this run are removed from the observability store.
- Non-optimize `config_mutation_events` and snapshots still referenced by
  remaining events are not part of optimize-history cleanup. They are pruned
  only by whole-store retention through `smx prune` or configured automatic
  gateway retention. Control Plane Audit Ledger rows remain under whole-store
  retention too.

Confirm the deleted run is gone:

```bash
smx optimize show "$RUN_ID" --json
```

Expected result:

- The command exits nonzero.
- The JSON error code is `optimize_not_found`.

Optionally clear all remaining optimize-history records in the local dev store:

```bash
smx optimize clear --json \
  | tee /tmp/smx-optimize-clear.json
```

Expected result:

- The command returns `"ok": true`.
- `.data.scope` is `"all"`.
- `.data.result.total_deleted` is a number.
- Only optimize runs, optimize-owned committed mutation records, and orphaned
  managed snapshots owned by those records are removed. Trace rows and benchmark
  rows are not deleted by optimize-history cleanup.
- General config mutation history and Control Plane Audit Ledger rows are not
  cleared by this command.

### Optional cleanup

If Step 10 was skipped or failed before restoring, restore the starting state
manually:

```bash
smx routes update gpt-4o-mini --service-provider openai_direct --json
smx gateway reload --config ./config.json --json || smx gateway restart --json
smx routes show gpt-4o-mini --json | jq -r '.data.service_provider'
```

Expected result:

```text
openai_direct
```

### Troubleshooting

If dry run reports `changed: false`, the target route is probably already on
the winning provider. Restore it to `openai_direct` and rerun the test.

If `WINNER_PROVIDER` is not `openrouter`, the live latency results did not
match this test fixture. Do not apply the run for this test case; run optimize
again or investigate why OpenRouter is slower in that environment.

If apply exits nonzero, inspect `.data.reload` and `.data.verification` in
`/tmp/smx-optimize-apply-real.json`. A reload or verification failure is
reported separately from the config mutation.

If reload fails after mutation, restart the gateway and rerun health and route
tests:

```bash
smx gateway restart --json
smx gateway health --check all --json
smx test --route gpt-4o-mini --json
```
