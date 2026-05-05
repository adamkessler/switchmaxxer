Project Plan for MCP Secrets

The clean phased plan to study and execute.

**Phase 1: Understand The Boundary**
Goal: separate “terminal environment” from “OpenClaw-launched MCP environment.”

- Terminal `smx` works because `.bashrc` exports keys.
- OpenClaw `smx mcp serve` does not automatically source `.bashrc`.
- Therefore, MCP direct benchmarks need their own deterministic way to see keys.

**Phase 2: Create Switchmaxxer Secrets File**
Goal: put real provider keys in a local-only JSON file.

Path:

```bash
~/.config/switchmaxxer/secrets.json
```

Shape:

```json
{
  "api_key_overrides": {
    "SWITCHMAXXER_OPENAI_API_KEY": "...",
    "SWITCHMAXXER_MINIMAX_API_KEY": "..."
  }
}
```

This file does not go in GitHub.

**Phase 3: Lock Down File Permissions**
Goal: make the local secrets file owner-only.

```bash
mkdir -p ~/.config/switchmaxxer
chmod 700 ~/.config/switchmaxxer
chmod 600 ~/.config/switchmaxxer/secrets.json
```

**Phase 4: Verify Switchmaxxer Can Read It**
Goal: prove `smx` can resolve provider keys from `secrets.json`.

Run:

```bash
SWITCHMAXXER_SECRETS_PATH=~/.config/switchmaxxer/secrets.json \
  ./smx config validate --config ./config.json --json
```

Then test a route that needs the key:

```bash
SWITCHMAXXER_SECRETS_PATH=~/.config/switchmaxxer/secrets.json \
  ./smx invoke --route gpt-4o-mini --prompt "Say ok"
```

**Phase 5: Tell OpenClaw To Pass The Path**
Goal: add the env var to OpenClaw’s MCP server entry.

In OpenClaw config:

```json
"env": {
  "SWITCHMAXXER_OBSERVABILITY_DB": "/home/adam-kessler/dev/switchmaxxer/.switchmaxxer/observability.sqlite",
  "SWITCHMAXXER_SECRETS_PATH": "/home/adam-kessler/.config/switchmaxxer/secrets.json"
}
```

OpenClaw does not read the file. It only passes the env var. Switchmaxxer reads the file.

**Phase 6: Restart OpenClaw**
Goal: make OpenClaw relaunch the MCP server with the new env.

```bash
openclaw gateway restart
```

**Phase 7: Verify MCP Behavior**
Goal: prove OpenClaw-spawned `smx mcp serve` can now benchmark direct/gateway/both.

The fastest, no-cost verification is an MCP `providers_show` call (does not
spend tokens):

```json
{
  "name": "openai_direct"
}
```

The response's `auth_source` should read `"secrets override"`. If it reads
`"env var"`, the env didn't reach the MCP child — verify OpenClaw re-spawned it
after editing the config. Restarting the SMX gateway is unrelated; the MCP
child is owned by OpenClaw.

Once `auth_source` looks correct, exercise the full path:

```json
{
  "route_id": "gpt-4o-mini",
  "prompt": "Return exactly ok.",
  "iterations": 1,
  "warmup": 0,
  "concurrency": 1,
  "path_mode": "direct"
}
```

If `direct` works, the MCP server has the key.

**Phase 8: Clean Up The Old Mental Model**
Goal: stop depending on `.bashrc` for non-terminal processes.

Keep `.bashrc` exports if useful for your own terminal, but treat `secrets.json` as the canonical local secret source for:

- managed gateway
- OpenClaw-spawned MCP
- other local automation

The core move is:

```text
from: “my shell exports keys”
to:   “each process gets SWITCHMAXXER_SECRETS_PATH”
```

## Coverage of the secrets file

The operator-facing reference for which SMX surfaces honor
`SWITCHMAXXER_SECRETS_PATH` lives in
[../subsystems/config/config-reference.md](../subsystems/config/config-reference.md)
under the local secrets-file location section. That is the canonical home;
update it there when the coverage changes and link back from this plan if
needed for engineering context.