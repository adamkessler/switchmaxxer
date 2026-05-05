# Security Policy

## Reporting A Vulnerability

Please do not open public GitHub issues for suspected security vulnerabilities.

Preferred reporting path:

1. Use GitHub's private vulnerability reporting flow for this repository if it is enabled.
2. If private reporting is not available yet, contact the maintainer privately through the repository owner's public GitHub profile before disclosing details publicly.

When reporting, please include:

- a short title
- affected area or command surface
- reproduction steps
- real impact
- any logs, payloads, or config fragments needed to reproduce safely
- suggested remediation if you have one

## What Counts As A Security Issue

Examples include:

- authentication or authorization bypass
- unintended exposure of secrets or provider credentials
- unsafe handling of local trust boundaries
- privilege escalation through CLI, gateway, or MCP surfaces
- request smuggling, SSRF, or unsafe upstream routing behavior
- vulnerabilities that could affect downstream operators using the default product posture

## Disclosure Expectations

- We will try to acknowledge reports promptly.
- Please avoid public disclosure until the issue has been reviewed and a fix or mitigation is available.
- If the report turns out not to be a security issue, we may ask that it be redirected into the normal public issue tracker instead.

## Current Security-Sensitive Operator Tradeoffs

### Private Provider Endpoints

By default, Switchmaxxer rejects provider endpoints that resolve to loopback,
private, link-local, multicast, and other non-public addresses, and it keeps
DNS pinning enabled for allowed public provider hosts.

The default outbound provider endpoint policy rejects endpoints that target:

- loopback hostnames and addresses, including `localhost`, `*.localhost`,
  `127.0.0.0/8`, `::1`, and IPv4-mapped IPv6 loopback forms
- RFC 1918 private IPv4 ranges: `10.0.0.0/8`, `172.16.0.0/12`, and
  `192.168.0.0/16`
- IPv4 link-local addresses such as `169.254.0.0/16`, including common
  instance-metadata address forms
- non-public, reserved, benchmark, documentation, carrier-grade NAT, multicast,
  and broadcast IPv4 ranges such as `0.0.0.0/8`, `100.64.0.0/10`,
  `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`,
  `198.51.100.0/24`, `203.0.113.0/24`, and `224.0.0.0/4` and above
- IPv6 unspecified, loopback, link-local, unique-local, multicast,
  NAT64 well-known prefix, 6to4, and Teredo-like ranges handled by the
  endpoint policy
- IPv4-mapped IPv6 addresses when the embedded IPv4 address would be rejected
- non-canonical numeric host notation that could otherwise hide a private or
  local address

Hostnames are checked twice: first as configured, then again after DNS
resolution. If a public-looking hostname resolves to a private or local
address and `allow_private_endpoints` is not enabled, the request is rejected.
Allowed DNS resolutions are pinned for the outbound socket connection so the
address selected during policy validation is the address used for the actual
request. Pinned public-host resolutions are cached for 60 seconds by default in
[src/subsystems/hot-path/manatee/proxy/provider-endpoint-policy.ts](src/subsystems/hot-path/manatee/proxy/provider-endpoint-policy.ts).
Redirect following is disabled for upstream fetches.

If an operator sets `allow_private_endpoints: true` for a provider, that is an
explicit opt-in to trusted local or private-address routing for that provider:

- private-address destinations become allowed
- DNS hostnames still use pinned-resolution dispatch so the address chosen at
  policy-check time is the address used by the socket connection
- literal IP endpoints and `localhost`-style names do not need DNS pinning
  because there is no external DNS hostname to rebind

This is acceptable for intentionally trusted local or private-network routing,
such as on-prem model gateways, but it should not be treated as a harmless
"allow RFC1918 only" switch. Private-address routing still expands what the
gateway is allowed to contact, so enable it only for provider endpoints whose
destination and network path are intentionally trusted.

### Forwarded Header Safety

When proxying a caller request upstream, Switchmaxxer removes hop-by-hop
headers, transport-managed headers, and provider-auth headers from the inbound
request before forwarding. Provider credentials are attached from the trusted
route configuration, not copied from the caller.

Forwarded header names must match the HTTP token character set. Forwarded
header values are capped at 8 KiB each and may contain only horizontal tab,
space, and printable ASCII. Values containing CRLF, other control characters,
or high-byte characters are rejected instead of being forwarded. This prevents
caller-supplied headers from being folded into additional upstream headers. The
cap is enforced by `MAX_FORWARDED_HEADER_VALUE_BYTES` in
[src/subsystems/hot-path/manatee/proxy/proxy-headers.ts](src/subsystems/hot-path/manatee/proxy/proxy-headers.ts).

### MCP Trust Boundary

`switchmaxxer mcp serve` is a trusted local stdio control-plane surface. The
connected MCP client is treated as local operator automation for the duration of
that session; it is not a network listener for untrusted or multi-tenant
clients.

The authorization boundary for MCP tools is `mcp.capabilities` in `config.json`.
When `mcp` or `mcp.capabilities` is omitted, Switchmaxxer defaults MCP sessions
to read-only access and emits a warning. Higher capability tiers should be
granted only to trusted local automation:

- `read`: inspection tools only
- `mutation`: ordinary config/catalog mutation tools
- `privileged`: high-trust tools such as secret updates, pruning, benchmark
  execution, optimization runs, optimize apply/restore, and Ledger reads

Do not expose MCP stdio sessions to untrusted agents, remote users, or shared
automation unless the surrounding host environment provides the required
authentication, authorization, isolation, and audit controls.

### Invoke Inspection

`smx invoke --inspect` is a local operator debugging surface for one
non-streaming request. It captures request and response bodies and headers in
the running gateway process long enough for the CLI to render the four-hop
view, then discards the capture. It is not written to logs or to the
observability store.

Secret-bearing headers are masked by default. `--include-secrets` deliberately
prints auth-like headers in clear text and should only be used on a trusted
terminal when the operator intentionally needs full protocol visibility.
