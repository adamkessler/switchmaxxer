# How To Install Switchmaxxer On Ubuntu

## Purpose

This guide walks an operator through installing Switchmaxxer on an Ubuntu box,
creating a local config, wiring provider credentials, validating the setup, and
bringing the gateway up with at least one working route.

Use this when you are starting from a fresh Ubuntu machine and want a
step-by-step path instead of piecing the setup together from the README and the
config reference.

This guide assumes a source checkout. The Switchmaxxer public beta is
intentionally distributed from GitHub only — `package.json` has
`"private": true`, `npm publish` is disabled, and there is no
`npm install -g switchmaxxer` path. Install from the Git repository.

## What You Will Have At The End

By the end of this guide you will have:

- Node.js 22+ installed on Ubuntu
- a local Switchmaxxer checkout with dependencies installed and `dist/` built
- a runtime `config.json` and required provider/route/model `catalog.json`
- required `SWITCHMAXXER_*` environment variables exported
- a validated gateway config
- a running gateway on `127.0.0.1:4080`
- at least one route tested through the live gateway

## Before You Start

This guide assumes:

- Ubuntu with `sudo` access
- outbound internet access for `git`, `npm`, and your upstream model providers
- at least one provider API key you plan to use, unless you are only wiring a
  local no-auth provider such as Ollama

Current runtime requirement:

- Node.js 22+

## 1. Install Ubuntu Prerequisites

Refresh package metadata and install the basic tools used by the rest of the
setup:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git build-essential
```

## 2. Install Node.js 22

Switchmaxxer currently requires Node 22+.

One straightforward Ubuntu path is the current NodeSource Node 22 setup:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
```

Confirm the version:

```bash
node --version
npm --version
```

You should see a Node 22.x release.

## 3. Clone Switchmaxxer

Choose the directory where you want the repo to live, then clone it:

```bash
git clone <your-switchmaxxer-repo-url> switchmaxxer
cd switchmaxxer
```

If you are working from a private fork or internal mirror, use that URL instead.

## 4. Install Dependencies And Build

```bash
npm install
npm run build
```

Both repo launchers:

- `./switchmaxxer`
- `./smx`

expect a current `dist/` build. If you later pull source changes or edit
`src/`, rerun `npm run build`.

## 5. Create Local Config And Catalog Files

Start from the shipped examples:

```bash
cp config-examples/config.example.json config.json
cp config-examples/catalog.example.json catalog.json
chmod 0600 config.json catalog.json
```

The config example starts with secure content defaults, and the `chmod` command
above keeps both local JSON files owner-only so the hardened readers accept
them:

- inbound gateway auth is enabled through `inbound_api_key_env`
- `allow_unauthenticated_gateway` is `false`
- provider credential env vars use the required `SWITCHMAXXER_*` naming contract
- provider, route, and model definitions live in `catalog.json`, not `config.json`

## 6. Decide Which Providers And Routes You Actually Want

The example catalog includes starter definitions for:

- OpenAI direct
- Anthropic direct
- OpenRouter
- MiniMax
- local Ollama

You do not need to use all of them.

The three important catalog sections are:

- `service_providers`: the outbound provider definitions
- `models`: the logical model catalog
- `routes`: the stable names clients send in the request `model` field

Good first-step operator choices:

1. Keep one provider and one route to get to first success quickly.
2. Remove routes that point at providers you are not using yet.
3. Keep the route name stable and human-readable, because clients will use that
   value directly.

Example first route from the shipped config:

```json
"gpt-4o-mini": {
  "model": "gpt-4o-mini",
  "provider_model_id": "gpt-4o-mini",
  "service_provider": "openai_direct",
  "display_name": "GPT-4o-Mini"
}
```

That means a client request with:

```json
"model": "gpt-4o-mini"
```

will be sent through the `openai_direct` provider using provider model ID
`gpt-4o-mini`.

## 7. Export The Environment Variables Your Config References

Switchmaxxer now requires config-referenced secret env vars to use the
`SWITCHMAXXER_*` prefix.

At minimum, export:

- `SWITCHMAXXER_INBOUND_API_KEY`
- the provider API key env var for each provider you kept in `catalog.json`

Example for an OpenAI-backed first route:

```bash
export SWITCHMAXXER_INBOUND_API_KEY='replace-with-a-32+-character-token'
export SWITCHMAXXER_OPENAI_API_KEY='replace-with-your-openai-key'
```

If you prefer machine-local provider keys over shell exports, keep the provider
`api_key_env` names in `catalog.json` and put only the actual local override
values in `~/.config/switchmaxxer/secrets.json`:

```bash
mkdir -p ~/.config/switchmaxxer
cp config-examples/secrets.example.json ~/.config/switchmaxxer/secrets.json
chmod 0600 ~/.config/switchmaxxer/secrets.json
$EDITOR ~/.config/switchmaxxer/secrets.json
```

`secrets.json` is sparse. Delete unused entries, replace placeholder values,
and keep `SWITCHMAXXER_INBOUND_API_KEY` exported unless you intentionally
change the inbound gateway auth design.

Example for Anthropic instead:

```bash
export SWITCHMAXXER_INBOUND_API_KEY='replace-with-a-32+-character-token'
export SWITCHMAXXER_ANTHROPIC_API_KEY='replace-with-your-anthropic-key'
```

Example for a local Ollama route:

- no provider API key is required
- the local provider entry should keep `api_key_env: null`
- `allow_private_endpoints: true` and `allow_insecure_http: true` are expected
  for that local HTTP provider shape

If you want these variables to persist across new shells, add the exports to
your shell startup file such as `~/.bashrc`, then reload it:

```bash
source ~/.bashrc
```

Optional shell env-file pattern:

```bash
mkdir -p ~/.config/switchmaxxer
chmod 0700 ~/.config/switchmaxxer
$EDITOR ~/.config/switchmaxxer/shell.env
chmod 0600 ~/.config/switchmaxxer/shell.env
```

Put only simple shell assignment lines in that file:

```bash
SWITCHMAXXER_INBOUND_API_KEY=replace-with-a-32+-character-token
SWITCHMAXXER_OPENAI_API_KEY=replace-with-your-openai-key
SWITCHMAXXER_ANTHROPIC_API_KEY=replace-with-your-anthropic-key
SWITCHMAXXER_OPENROUTER_API_KEY=replace-with-your-openrouter-key
```

Then add this loader near the bottom of `~/.bashrc`:

```bash
# Switchmaxxer API keys
set -a
[ -f ~/.config/switchmaxxer/shell.env ] && source ~/.config/switchmaxxer/shell.env
set +a
```

This keeps real keys out of shell history and out of `config.json` while still
making them available to `./smx`, `./switchmaxxer`, and other commands launched
from new interactive shells. The file is sourced as shell code, so keep it
owner-only and do not put commands in it. Anything launched from that shell can
inherit those variables.

`systemd` services do not read `~/.bashrc`. For the service form, either create
the `EnvironmentFile=` shown later in this guide or point `EnvironmentFile=` at
the same env file only if it contains plain `KEY=value` assignments.

## 8. Validate The Config Before Starting The Gateway

Run:

```bash
./smx config validate --config ./config.json --json
```

You want:

```json
"valid": true
```

If validation fails, fix that before trying to start the gateway. Common causes:

- a required `SWITCHMAXXER_*` env var is missing
- a route points at a provider ID that does not exist
- a provider endpoint shape does not match its declared `api_mode`
- the inbound auth token is missing or too short

## 9. Start The Gateway

Foreground mode is the simplest first-run path:

```bash
./smx gateway run --config ./config.json
```

By default the gateway listens on:

```text
127.0.0.1:4080
```

Leave that terminal open while you test from a second shell.

## 10. Confirm The Gateway Is Healthy

In another terminal:

```bash
curl http://127.0.0.1:4080/health
```

The health payload is intentionally minimal. A healthy response should look like:

```json
{"status":"ok","process_integrity_status":"ok"}
```

You can also ask the CLI for a richer operator summary:

```bash
./smx gateway status --config ./config.json --json
```

## 11. Test One Route Through The Live Gateway

Use the built-in route test first:

```bash
./smx test --config ./config.json --route gpt-4o-mini
```

Replace `gpt-4o-mini` with the route you actually kept in your config.

This is the best first proof because it exercises:

- config loading
- inbound auth wiring
- live gateway reachability
- route resolution
- upstream provider connectivity

## 12. Send A Real Client Request

OpenAI-compatible example:

```bash
curl http://127.0.0.1:4080/v1/chat/completions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $SWITCHMAXXER_INBOUND_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "user", "content": "Reply with exactly: switchmaxxer-ok" }
    ]
  }'
```

Anthropic-compatible example:

```bash
curl http://127.0.0.1:4080/anthropic/v1/messages \
  -H 'content-type: application/json' \
  -H "x-api-key: $SWITCHMAXXER_INBOUND_API_KEY" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 32,
    "messages": [
      { "role": "user", "content": "Reply with exactly: switchmaxxer-ok" }
    ]
  }'
```

The route name you configured is the client-facing `model` value.

## 13. Add Or Change Routes

You have two normal operator paths.

Edit `config.json` directly:

- simplest when you are just getting started
- easiest when you want to review the whole config in one file

Use the CLI CRUD commands:

- useful once you are iterating regularly
- good for scripts and repeatable operational changes

Example provider creation:

```bash
./smx providers create openai_direct_custom \
  --endpoint "https://api.openai.com/v1/chat/completions" \
  --api-mode openai-completions \
  --api-key-env SWITCHMAXXER_OPENAI_API_KEY
```

Example route creation:

```bash
./smx routes create gpt-4o-mini-custom \
  --model gpt-4o-mini \
  --service-provider openai_direct_custom \
  --provider-model-id gpt-4o-mini \
  --display-name "GPT-4o Mini Custom"
```

After config changes:

```bash
./smx config validate --config ./config.json
```

If the gateway is already running, either restart it or ask it to reload:

```bash
./smx gateway reload --config ./config.json
```

Then re-test the affected route:

```bash
./smx test --config ./config.json --route gpt-4o-mini-custom
```

## 14. Optional: Run Switchmaxxer As A User Service

Once foreground mode is working, a `systemd --user` service is the normal
long-running Ubuntu path.

The short version:

```bash
mkdir -p ~/.config/systemd/user
mkdir -p ~/.config/switchmaxxer
```

Create:

- `~/.config/systemd/user/switchmaxxer.service`
- `~/.config/switchmaxxer/switchmaxxer.env`

Use this service shape:

```ini
[Unit]
Description=Switchmaxxer LLM Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/switchmaxxer
ExecStart=/absolute/path/to/switchmaxxer/switchmaxxer gateway run --config /absolute/path/to/switchmaxxer/config.json
Restart=on-failure
RestartSec=2
EnvironmentFile=%h/.config/switchmaxxer/switchmaxxer.env

[Install]
WantedBy=default.target
```

Then:

Create the service environment file before starting the service:

```bash
mkdir -p ~/.config/switchmaxxer
chmod 0700 ~/.config/switchmaxxer
cat > ~/.config/switchmaxxer/switchmaxxer.env <<'EOF'
SWITCHMAXXER_INBOUND_API_KEY=replace-with-a-32+-character-token
SWITCHMAXXER_OPENAI_API_KEY=replace-with-your-openai-key
EOF
chmod 0600 ~/.config/switchmaxxer/switchmaxxer.env
```

Use only the `SWITCHMAXXER_*` keys your config actually references.

```bash
systemctl --user daemon-reload
./smx gateway enable --config ./config.json
./smx gateway start --config ./config.json
./smx gateway status --config ./config.json --json
```

For the fuller service-management walkthrough, see
[how-to-operate-the-switchmaxxer-gateway.md](how-to-operate-the-switchmaxxer-gateway.md).

## Troubleshooting

### `node --version` is less than 22

You are on the wrong runtime version for the current repo.

Fix:

- install Node 22+
- rerun `npm install`
- rerun `npm run build`

### `config validate` says an env var is missing

Switchmaxxer now expects config-referenced secret env vars to use the
`SWITCHMAXXER_*` naming contract.

Fix:

1. export the missing variable in the same shell
2. confirm with `env | grep '^SWITCHMAXXER_'`
3. rerun `./smx config validate --config ./config.json`

### `smx test --route ...` says the gateway is unavailable

Usually one of these is true:

- the gateway is not running
- it is running with a different config file
- it is listening on a different host or port
- the route health preflight is failing before the request path begins

Good checks:

```bash
./smx gateway status --config ./config.json --json
./smx gateway runtime config --config ./config.json --json
```

### The route works with `--no-gateway` but fails through the gateway

That usually means the provider is reachable but the live gateway path still has
an issue such as:

- inbound auth mismatch
- wrong live config loaded into the running gateway
- route name mismatch in the client request
- gateway listener not using the config file you expected

Compare:

```bash
./smx test --config ./config.json --route <route-id> --no-gateway
./smx test --config ./config.json --route <route-id>
```

### I want localhost-only development with no inbound gateway token

This is allowed, but it is a development-only escape hatch. Keep inbound auth
enabled for normal use, including loopback use.

In `config.json`:

```json
"inbound_api_key_env": null,
"allow_unauthenticated_gateway": true
```

Then validate again:

```bash
./smx config validate --config ./config.json
```

Use that posture only when you intentionally want unauthenticated localhost-only
development access. Loopback no-auth is not safe against malicious webpages by
itself; browsers can send requests to local services even when they cannot read
the response. Unauthenticated gateway POSTs must include
`Content-Type: application/json` and, unless
`one_trusted_operator_boundary: true` is explicitly configured,
`X-Switchmaxxer-Local-Client: 1`; Switchmaxxer rejects cross-site browser
request metadata.

## Next Documents

After this guide, the most useful follow-up docs are:

- [how-to-operate-the-switchmaxxer-gateway.md](how-to-operate-the-switchmaxxer-gateway.md)
- [config-reference.md](../subsystems/config/config-reference.md)
- [tech-spec-for-cli-surface.md](../subsystems/cli/tech-spec-for-cli-surface.md)
