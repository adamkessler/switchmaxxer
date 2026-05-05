# Changelog

Switchmaxxer is still pre-release. This file exists only to reflect the current project version while the release process is still lightweight.

## [Unreleased]

## [0.0.5] - 2026-05-05

- mcp: switched the stdio JSON-RPC transport from LSP-style `Content-Length`
  framing to the MCP-spec newline-delimited JSON framing, so MCP hosts using
  the official `@modelcontextprotocol/sdk` (Claude Desktop, Claude Code,
  OpenClaw, VS Code MCP, Cursor) can complete the `initialize` handshake
  against `smx mcp serve` without timing out
- optimize: `optimize_apply` and `optimize_restore` now atomically rewrite
  three fields on the target route — `service_provider`,
  `provider_model_id`, and `cost` — so a successful apply leaves the route
  consistent with the new upstream's identifier and pricing instead of leaving
  stale fields behind
- optimize: the `mutation` envelope returned to clients now includes per-field
  `service_provider`, `provider_model_id`, and `cost` diffs (`{ changed,
  from, to }`) in addition to the legacy `field`/`from`/`to` keys
- optimize: `optimize_restore` round-trips all three fields back to the
  pre-apply state captured in the apply event's `before_json`
- mutation: the post-mutation catalog validator now honors
  `SWITCHMAXXER_SECRETS_PATH` overrides when checking each route's provider
  auth, so MCP-driven mutations from a child process that has only the
  secrets path in its environment no longer fail on unrelated routes
- inbound auth: `inbound_api_key_env` is now resolved from the secrets file
  too, symmetrically with provider `api_key_env`. The production config
  validator, the post-mutation validator, and the request-time gateway
  inbound auth resolver all accept a secrets-file value when the env var is
  unset in the process. A gateway or MCP child whose only configured env
  entry is `SWITCHMAXXER_SECRETS_PATH` can now resolve every required token
  without materializing them as individual env vars.
- mcp: `providers_create` now accepts an optional `no_auth: true` field for
  symmetry with `providers_update`; passing `false` is rejected because
  `providers_create` always creates a no-auth provider
- packaging: renamed `configs/` to `config-examples/` for clarity; updated
  the package allowlist, `.npmignore`, all tests, and all docs to match
- runtime state: catalog and config backups now land under
  `<config-dir>/.switchmaxxer/catalog-backups/<basename>.bak` instead of as
  siblings at the project root
- mcp: report the package version through `getPackageVersion()` in the
  `initialize` response so the MCP server version stays in lockstep with
  `package.json`
- tests: the unit-test runner sets an isolated `XDG_CONFIG_HOME` for each
  child test process so the developer's `~/.config/switchmaxxer/secrets.json`
  cannot leak `auth_source: "secrets override"` into tests that expect
  `auth_source: "env var"`
- docs: added an OpenClaw integration skill at
  `docs/ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md`
  capturing the route-vs-canonical-model distinction, the
  `model`-vs-`model_id` MCP field name gotcha, and the `auth_source`
  resolution mechanism, with a Step 0 in
  `docs/how-to/how-to-connect-openclaw-to-switchmaxxer.md` instructing
  operators to load it before running OpenClaw agents against Switchmaxxer
- docs: README now has a top-level `Disclaimers` section linking to
  `DISCLAIMER.md`, and the install sections in `README.md` and the Ubuntu
  install guide describe the public-beta `private: true` posture explicitly
  rather than implying npm publication is "coming later"
- chore: removed four stale unused imports flagged by ESLint

## [0.0.4] - 2026-04-28

Public beta release.

- release: prepared the repository, documentation, packaging checks, and CI
  gates for public beta distribution from source
- security: hardened provider and inbound gateway secret handling, redaction,
  and contract checks
- gateway: added inbound gateway auth client-surface coverage for local invoke,
  test, and benchmark flows
- observability: stabilized gateway observation worker timeout behavior under
  Node 22 test runners
- tests: made the self-contained integration suite build deterministically and
  pass in CI without live services
- tooling: removed CI dependencies on `rg` from contract and import-boundary
  checks

## [0.0.3] - 2026-04-27

- security: kept gateway request rate limiting explicitly keyed by source IP and
  renamed header-derived caller metadata to an untrusted display label
- security: added a contract check that restricts `SecretString.reveal()` calls
  to the provider-auth unwrap boundary and the secret redaction test
- hardening: expanded import-boundary checks for config mutation, config
  validation, proxy internals, and gateway observability internals
- refactor: shared CLI long-flag parsing across model, provider, route, config,
  and cost argument parsers
- observability: aligned gateway observation worker write-result typing with the
  returned dropped-count payload
- docs: refreshed proxy documentation to distinguish trusted rate-limit keys
  from untrusted caller display labels
- docs: added a standalone Ubuntu installation guide and refreshed the docs
  index links
- docs: normalized SWE tech spec naming around the `tech-spec-for-*` convention
- docs: expanded runtime, gateway, and MCP technical notes to capture current
  security-hardening assumptions and operational contracts
- docs: moved observability subsystem reference material under
  `docs/subsystems/observability/`
- docs: aligned README and packaged docs so the same README works from the Git
  repository and the npm package artifact
- packaging: added a positive package allowlist and excluded source maps,
  compiled tests, repo-readiness notes, prompts, and internal engineering docs
  from the npm package artifact
- security: documented the MCP trust boundary in `SECURITY.md`
- observability: added and documented the Control Plane Audit Ledger,
  optimize apply/restore audit flow, and scoped Ledger read surfaces
- observability: tightened optimize apply/restore parity across CLI and MCP and
  made config mutation history record only committed effective mutations
- tests: refreshed integration smoke coverage to match the current
  config/catalog split, pruning surface, and CLI/MCP observability contracts

## [0.0.2] - 2026-04-21

Initial release.
