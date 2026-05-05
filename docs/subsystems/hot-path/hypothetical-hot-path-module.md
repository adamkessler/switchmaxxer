# Hypothetical Hot-Path Modules: Manatee, Fire Horse, Rust Horse

> A think piece on what it would take to factor Switchmaxxer's per-request
> hot path behind a swappable contract, with three implementations:
>
> - **Manatee** — in-process TypeScript (the reference implementation)
> - **Fire Horse** — out-of-process Java 21 (modern JVM with virtual
>   threads, records, sealed types, and optional GraalVM native-image)
> - **Rust Horse** — out-of-process Rust (native perf, no warmup)
>
> This is design exploration, not a proposal. The intent is to surface the
> contract that all three share, the differences in how each one realizes
> that contract, and the costs of supporting all three.

## 1. Framing

Today the hot path lives in TypeScript and runs in the same Node process as
config loading, observability writes, and the read-only control plane. The
existing hot path is small (~8k lines across ~48 files), tight, and disciplined
about what it does. See [tech-spec-for-hot-path.md](../../architecture/tech-spec-for-hot-path.md)
for the canonical inventory.

The hypothesis behind factoring it out:

- The hot path is **the slice of smx that benefits from being polyglot**.
  Per-request CPU work — JSON parse, dialect translation, SSE relay — is
  where language and runtime choice show up in latency and throughput.
- Cold-path work — config CRUD, CLI, MCP, observability persistence,
  optimization, bench, the read-only control plane — does not benefit from
  a different runtime and is much cheaper to keep in TypeScript where it
  already is.
- The smx process retains primacy: it owns config files, the catalog, the
  observability ledger, the CLI surface, and the lifecycle of any
  out-of-process hot-path child. Out-of-process hot paths are managed
  children, not peer services.

The architecture admits three implementations behind one contract. The
big picture, with the adapter pattern made explicit:

```
            smx core
              │
              │ programs against HotPath interface
              │
       ┌──────▼──────┐
       │   HotPath   │   <-- TypeScript interface, the contract
       └──────┬──────┘
              │
   ┌──────────┼──────────────┬──────────────┐
   │          │              │              │
┌──▼─────┐ ┌──▼──────────┐ ┌─▼─────────────┐
│Manatee │ │FireHorse-   │ │RustHorse-     │
│        │ │Adapter      │ │Adapter        │
│in-proc │ │             │ │               │
│        │ │spawns JVM,  │ │spawns Rust,   │
│direct  │ │wires stdin/ │ │wires stdin/   │
│TS calls│ │fd3, framed  │ │fd3, framed    │
└────────┘ └─────────────┘ └───────────────┘
```

The contract is the **TypeScript `HotPath` interface**. Manatee is the
in-process reference implementation — it implements the interface
directly with TS function calls. Fire Horse and Rust Horse run as
separate child processes; smx never calls them directly. Instead, smx
talks to **adapter objects** that live in the smx process and implement
the same `HotPath` interface, then serialize each method call onto
framed pipes (stdin for commands, fd 3 for observations) to drive the
external binary. From smx's point of view, all three are just objects
that satisfy the interface — the adapter does the IPC dance internally.

Zooming in to show what happens behind each box, including the smx-side
machinery that out-of-process implementations need:

```
                          smx (TypeScript)
                  ┌──────────────────────────────┐
                  │  config  catalog  CLI  MCP   │
                  │           observability       │
                  │                               │
                  │     ┌─────────────────────┐   │
                  │     │  HotPath interface  │   │
                  │     └──────────┬──────────┘   │
                  └────────────────┼──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
  ┌─────▼──────┐         ┌─────────▼─────────┐      ┌─────────▼─────────┐
  │  Manatee   │         │  FireHorse-       │      │   RustHorse-      │
  │            │         │  Adapter          │      │   Adapter         │
  │ in-process │         │  (in smx)         │      │   (in smx)        │
  │ TypeScript │         │     │             │      │     │             │
  │            │         │     ▼             │      │     ▼             │
  │            │         │  spawned JVM      │      │  spawned Rust     │
  │            │         │  child (Java 21   │      │  child (hyper +   │
  │            │         │  + Netty)         │      │  simd-json)       │
  │ no IPC     │         │  stdin: cmds      │      │  stdin: cmds      │
  │ no spawn   │         │  stdout: replies  │      │  stdout: replies  │
  │            │         │  fd 3: observ.    │      │  fd 3: observ.    │
  └────────────┘         └───────────────────┘      └───────────────────┘
```

The two-level zoom matters because it makes one thing easy to miss
visible: the **adapter** lives in smx, the **child process** lives
elsewhere. The interface is what they share; the IPC is what the
adapter hides.

The contract lives in TypeScript, not in a wire spec. The wire format is
*derived from* the contract — every interface method becomes a frame type,
observations become an event stream — and exists only to serve the
out-of-process adapters. Manatee never touches a wire.

Selection happens at config time:

```jsonc
"hotPath": {
  "kind": "manatee" | "firehorse" | "rusthorse",
  "binary": "/optional/override/path"
}
```

If the chosen implementation isn't available (e.g., no Rust binary for the
host platform), smx falls back to Manatee with a warning rather than
refusing to start. **Manatee is always available** because it ships as part
of smx's TypeScript source.

### Repo and distribution layout

The default hot path travels with the project that calls it default; the
others ship themselves:

- **Manatee** lives **in the smx repo** under
  `src/subsystems/hot-path/manatee/`. It is the reference implementation
  and the always-available fallback, so coupling it to smx's release
  cadence is the right choice — every smx checkout has a working hot
  path on day one.
- **Fire Horse**, when built, lives in its **own repo** and ships as
  its own distribution (a JVM binary, a `jlink` JRE, or a GraalVM
  native-image binary). Smx depends on the Fire Horse distribution at
  install time only when a user opts in.
- **Rust Horse**, when built, lives in its **own repo** and ships as a
  per-platform native binary. Same opt-in model.
- **Smx-side adapters** for Fire Horse and Rust Horse — the small TS
  classes that spawn and frame-pipe the external children — live
  inside the smx repo alongside Manatee:
  `src/subsystems/hot-path/firehorse-adapter/` and
  `src/subsystems/hot-path/rusthorse-adapter/`. They are part of smx
  because smx is what supervises them.

The rule, stated cleanly: **smx ships its default and the supervisor
scaffolding for alternatives; alternatives ship themselves.** Nobody
pays for a JDK or a Rust toolchain unless they opted in. The directory
layout under `src/subsystems/hot-path/` makes the boundary visible:

```
src/subsystems/hot-path/
├── contract/                  # the HotPath interface + types
├── manatee/                   # default in-process implementation
├── firehorse-adapter/         # (future) smx-side spawner for Fire Horse
└── rusthorse-adapter/         # (future) smx-side spawner for Rust Horse
```

The contract is its own subdirectory rather than living under
`manatee/`. That matters because the contract is shared with the future
adapters; if it lived under `manatee/`, Manatee would be the de facto
contract owner, which is the wrong relationship. The contract precedes
any implementation.

## 2. The Contract

### 2.1 The TypeScript interface

```typescript
// smx/src/subsystems/hot-path/hot-path.ts

export interface HotPath {
  start(snapshot: HotPathSnapshot): Promise<void>;
  reload(snapshot: HotPathSnapshot): Promise<void>;
  drain(graceMs: number): Promise<void>;
  shutdown(): Promise<void>;
  status(): Promise<HotPathStatus>;
  observations(): AsyncIterable<HotPathObservation>;
}

export function createHotPath(cfg: HotPathConfig): HotPath {
  switch (cfg.kind) {
    case "manatee":   return new Manatee(cfg);
    case "firehorse": return new FireHorseAdapter(cfg);
    case "rusthorse": return new RustHorseAdapter(cfg);
  }
}
```

Three rules govern the interface so the wire derivation is mechanical:

1. **Plain-data parameters.** `HotPathSnapshot`, `HotPathStatus`, and
   `HotPathObservation` round-trip through JSON with no information loss.
   No class instances, no Buffer references, no callbacks-in-payloads.
2. **Async iteration over observations**, not push-style listeners. An
   AsyncIterable is easy to back with a stream of frames; an EventEmitter
   with arbitrary payloads is not.
3. **No back-references.** An observation cannot carry a "request handle"
   the consumer can later call methods on. Use opaque IDs and explicit
   methods if such a flow is needed.

These constraints are what make Fire Horse and Rust Horse implementable
behind the same interface as Manatee. They also tend to be the right
constraints regardless — they're what gRPC, JSON-RPC, and similar
frameworks impose for the same reasons.

### 2.2 The snapshot

`HotPathSnapshot` is the immutable bundle of fields any hot-path
implementation needs to do its work. It's the answer to "what does the
hot path need to know?":

```typescript
export interface HotPathSnapshot {
  // Listener
  bindHost: string;
  port: number;
  maxConnections: number;
  apiSurfaces: { openai: boolean; anthropic: boolean };

  // Auth + rate limit
  inboundAuthState: InboundAuthState;
  failedAuthLimitPolicy: { failureBudget: number; baseBackoffMs: number; maxBackoffMs: number };
  rateLimit: { requests: number; windowMs: number };

  // Concurrency caps
  jsonParseSlots: number;            // default 4
  streamingSlotsPerIp: number;       // default 8

  // Body limits
  bodySizeLimitBytes: number;
  bodyReadIdleTimeoutMs: number;
  bodyReadTotalTimeoutMs: number;

  // Upstream
  upstreamConnectTimeoutMs: number;
  upstreamRequestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  streamLifetimeTimeoutMs: number;
  streamRateOfProgressBytesPerSec: number;
  dnsPinPolicy: { enabled: boolean; cacheTtlMs: number };

  // Routes
  routes: Record<string, RouteEntry>;   // keyed by client-supplied model id

  // Misc
  logLevel: string;
  redactionPolicy: RedactionPolicy;
  corsPolicy?: CorsPolicy;
  processStartedAt: string;
  snapshotLoadedAt: string;
  snapshotId: string;
}

export interface RouteEntry {
  apiMode: "openai" | "anthropic";
  upstream: { baseUrl: string; defaultHeaders: Record<string, string>; apiKeyRef: SecretRef };
  upstreamModelId: string;
  costConfig?: CostConfig;
  perRouteTimeouts?: Partial<UpstreamTimeouts>;
}
```

The snapshot is sent to the hot path at `start()` and at every `reload()`.
Manatee receives it as a TypeScript object reference. Fire Horse and Rust
Horse receive it as length-prefixed JSON over stdin. Either way, the hot
path never asks smx for fields piecemeal — it has everything it needs the
moment a snapshot is in hand.

### 2.3 The wire (out-of-process implementations only)

For Fire Horse and Rust Horse, the same interface is realized over framed
pipes set up at spawn time:

```
       ┌─────────────────────────┐         ┌─────────────────────┐
       │  smx (Node)             │         │  Fire Horse (JVM)   │
       │                         │         │  or Rust Horse      │
       │  ┌───────────────────┐  │  stdin  │                     │
       │  │  control client   │──┼─────────┼─► commands          │
       │  └───────────────────┘  │         │                     │
       │                         │  stdout │                     │
       │  ◄──────────────────────┼─────────┼── replies           │
       │                         │   fd 3  │                     │
       │  ◄──────────────────────┼─────────┼── observations      │
       │                         │  stderr │                     │
       │  ◄──────────────────────┼─────────┼── unstructured logs │
       └─────────────────────────┘         └─────────────────────┘
                                                    │
                                                  TCP│ data plane
                                                    ▼
                                              upstream API
```

Each frame is a 4-byte big-endian length prefix followed by a JSON or CBOR
payload. The frame type is part of the payload (`{kind: "reload", ...}`,
`{kind: "request_completed", ...}`). Stdin carries commands inbound,
stdout carries replies outbound, fd 3 carries observations. Stderr is
left for unstructured runtime output.

This is approximately stdio framing with an extra pipe — a parent/child
pipe set up by Node's `child_process.spawn` with
`stdio: ['pipe', 'pipe', 'pipe', 'pipe']`, which works on Linux, macOS,
and modern Windows without conditional code.

## 3. Inbound HTTP and the Three Trust Contracts

When the hot path is in-process (Manatee), the existing TS comments like:

> Trust contract: the router has already enforced control-plane auth, local
> Host rules, unauthenticated browser defenses, and caller rate limits.

remain intra-process invariants — they hold because every byte walks
through the same module graph. When the hot path is out-of-process (Fire
Horse, Rust Horse), the same invariants must hold across a process
boundary, so they become properties of the contract instead of properties
of the source tree.

### 3.1 Where TLS terminates

For all three implementations, **clients hit the hot path's listening port
directly**; smx never sits in the data path. This raises the question of
where TLS — the encryption layer that turns HTTP into HTTPS — gets
terminated. Two options:

- **The hot path terminates TLS itself.** It holds the server private key,
  decrypts inbound bytes into plaintext HTTP, and re-encrypts on the way
  out. This pulls cert loading, SNI handling, OCSP stapling, and key
  rotation into the hot-path module — which means three times: once in
  Manatee, once in Fire Horse, once in Rust Horse.
- **A fronting proxy terminates TLS.** Something like nginx, Caddy, or an
  ALB sits in front of the hot path, terminates TLS, and hands plaintext
  HTTP over loopback. The hot path sees plaintext only.

All three implementations adopt the second option, mirroring smx's posture
today. TLS termination is a distinct responsibility with its own cert
lifecycle and operational tooling, and folding it into each hot path
expands surface area threefold without making any per-request work faster.
Keeping TLS out of the hot paths leaves those concerns to the surrounding
infrastructure where they already live, and keeps each implementation
focused on the work the rewrite is meant to accelerate.

### 3.2 The control channel (smx → out-of-process hot path)

For Fire Horse and Rust Horse, smx pushes config snapshots, signals
reload, drain, shutdown, and queries status over the control channel.
The constraint is that Switchmaxxer has to run on Linux, macOS, and
Windows. Several transports are viable:

- **Unix-domain socket.** Native on Linux/macOS, supported on Windows
  10 build 17063+ and Server 2019+. Authenticated by filesystem
  permissions (0600, smx's UID). Does not work on older Windows.
- **Named pipe (`\\.\pipe\fh-control`).** Windows-native; Node's `net`
  module abstracts it through the same `path` option as Unix sockets.
  Different path syntax per platform.
- **TCP loopback (127.0.0.1:N).** Fully portable, but opens a port that
  has to be authenticated separately with a shared token. Adds attack
  surface for no transport benefit.
- **File drop + signal.** smx writes `snapshot.json` to a known path
  and signals the child (SIGHUP on posix, a Win32 event on Windows).
  Simple for one-way snapshot push; awkward for status queries.
- **Stdin frames.** smx writes length-prefixed JSON to the spawned
  child's stdin; the child writes responses on its stdout.
  Authentication is implicit in the parent/child relationship — only
  the supervisor that owns the pipe can write to it.

The out-of-process implementations adopt stdin framing for the first
cut. The reason is portability without conditional code:
`child_process.spawn` works identically on every platform Switchmaxxer
targets, the pipe is always there because the supervisor opens it,
there is no socket file, port, or named pipe to create, secure, or clean
up after a crash, and authentication is free. The trade-off is that
control traffic muxes onto a single pipe shared with stdout/stderr
conventions, but for the small command set (`RELOAD`, `DRAIN`,
`SHUTDOWN`, `STATUS`) at human or near-human frequency, that is fine.
If a later need outgrows stdin, the transport can be swapped without
changing the message format.

Manatee has no control channel because there is no process boundary —
smx calls the interface methods directly.

### 3.3 The observation channel (out-of-process hot path → smx)

Fire Horse and Rust Horse stream structured events (request started,
request completed, upstream error, invoke-inspection capture) to smx,
which writes them into the persistent ledger. This is the *only* path
observability data takes; out-of-process hot paths never touch the
SQLite store.

Given that the control channel uses stdin/stdout, the question is which
file descriptor carries observations. The options:

- **Mux onto stdout.** Frame each message with a discriminator and have
  smx demux. Saves an fd, but interleaves two semantically different
  streams — a slow control reply could delay observation drain.
- **Use stderr.** Free with every spawn, but stderr conventionally
  carries panic traces and uncaught exception logs, which would mix
  with structured events.
- **A separate pipe (fd 3).** The supervisor spawns the child with
  `stdio: ['pipe', 'pipe', 'pipe', 'pipe']`, giving the child a fourth
  file descriptor dedicated to observation. Each channel stays
  single-purpose: stdin for commands, stdout for replies, stderr for
  raw logs, fd 3 for structured events.

Out-of-process implementations adopt the dedicated fd 3 pipe. It is
the natural extension of the control-channel decision — same transport
family, opened by the same supervisor at the same time, no socket file
or port to manage. The child reads the fd by number, passed via env
var (e.g., `FH_OBSERVATION_FD=3`); on Windows the supervisor passes an
inheritable pipe handle through `STARTUPINFO`. Each frame is one
`HotPathObservation` event with a 4-byte big-endian length prefix
followed by a JSON or CBOR payload.

Backpressure is natural: if smx falls behind, the kernel pipe buffer
fills, the child's writes briefly block, then the child's in-memory
ring buffer absorbs further events and increments a drop counter rather
than stalling the data plane.

Manatee emits observations in-process by yielding from its
`observations()` AsyncIterable. smx consumes them through the same
interface. Drop counters still appear when the consumer is slow, but
the mechanism is event-loop scheduling rather than a kernel pipe.

### 3.4 Read-only control plane GETs

The two read-only control-plane endpoints
(`/__switchmaxxer/runtime/config`, `/__switchmaxxer/runtime/inspect/<id>`)
share the data port. The hot path serves them directly so clients see one
port for all three planes (health, data, control read). For Manatee this
is just another path in the in-process router. For Fire Horse and Rust
Horse, these handlers run inside the child process and return a
serialized view of the snapshot the child currently holds — no IPC to
smx is needed to render them.

## 4. Manatee — In-Process TypeScript

Manatee is the existing TS hot path, refactored behind the `HotPath`
interface. It is the **reference implementation**: when behavior is
underspecified by the contract, Manatee defines what's correct.

```
        client ─── TCP ───▶ smx process : port 4080
                              │
                              ▼
                  ┌───────────────────────┐
                  │  Manatee (in-process) │
                  │                       │
                  │  parse → translate ─▶ │ ─ TCP ─▶ upstream
                  │  ◀──────── upstream ─ │ ◀ TCP ──
                  │                       │
                  │  observations ────────┼─▶ in-process
                  │                       │   ledger writer
                  └───────────────────────┘
                              │
                              ▼
                       client (TCP)
```

### 4.1 What changes from today

The current TS hot path calls smx-internal functions directly: it pulls
config from a module-level loader, writes observability events through
imported functions, and accesses the logger as a module singleton. That
shape is fine for in-process operation but couples the hot path to the
rest of smx — and would prevent the same code from being a faithful
reference implementation of the contract.

The carving-out work:

- The hot path's dependencies become explicit constructor parameters
  rather than module imports. Logger, observability sink, snapshot
  source — all passed in.
- Snapshot is delivered through `start(snapshot)` and `reload(snapshot)`
  rather than read from disk by the hot path itself.
- Observation events are produced through the AsyncIterable returned by
  `observations()` rather than emitted via direct function calls.

This is a real refactor — perhaps 1–2k lines of glue work in the existing
code — but it is the same refactor that would be needed to support
out-of-process implementations at all. It earns its keep regardless of
whether Fire Horse or Rust Horse ever ship.

### 4.2 What stays the same

Almost all of the per-request logic. The current files in
[src/subsystems/gateway/](../../../src/subsystems/gateway/) and
[src/subsystems/hot-path/manatee/proxy/](../../../src/subsystems/hot-path/manatee/proxy/) become Manatee's
internals with minimal change. The translators, validators, rate
limiters, streaming relay, error envelope writer — all unchanged in
substance, only repackaged behind the contract.

### 4.3 Manatee's character

- Always available. Ships as part of smx; no extra binary, no platform
  matrix.
- Lowest overhead at the smx boundary. Method calls are TS function calls,
  not framed pipe writes. No serialization tax on snapshots, no kernel
  pipe traffic for observations.
- Same runtime as smx. Crashes in Manatee crash smx; there is no isolation
  boundary. This is sometimes what you want and sometimes what you don't.
- Same throughput ceiling as today's TS hot path. Manatee does not make
  smx faster on its own; it makes smx swappable.

LOC: roughly the same as today's hot-path slice (~8,400) plus ~600 lines
of interface glue and adapter plumbing. **Approximate total: ~9,000 LOC
of TypeScript.**

## 5. Fire Horse — Out-of-Process Java 21

Fire Horse is a Java 21 process spawned and supervised by smx. It owns
the data port; smx talks to it only through the contract pipes.

```
       ┌─────────────────────┐               ┌──────────────────────┐
       │  smx (Node)         │               │  Fire Horse (JVM 21) │
       │                     │     stdin     │                      │
       │  control client ────┼───────────────┼─► RELOAD / DRAIN /  │
       │                     │               │   SHUTDOWN / STATUS  │
       │                     │     stdout    │                      │
       │  control client ◄───┼───────────────┼── replies            │
       │                     │     fd 3      │                      │
       │  obs consumer  ◄────┼───────────────┼── observations       │
       │                     │     stderr    │                      │
       │  log tee       ◄────┼───────────────┼── JVM stack traces   │
       └─────────────────────┘               └──────────┬───────────┘
                                                        │
                                                        │ TCP : 4080
                                                        │
                                              ┌─────────┴─────────┐
                                              │                   │
                                          inbound            outbound
                                          clients         upstream API
```

### 5.1 Why JDK 21

Fire Horse is an opt-in performance mode. A user who switches
`hotPath.kind` from `manatee` to `firehorse` is making a deliberate
choice and is willing to install the runtime that makes the JVM hot
path worth picking. **Targeting JDK 21** specifically (rather than 1.8
or 11) is what lets Fire Horse take full advantage of the modern JVM
and become a genuinely superior hot path:

- **Records** for the snapshot and every other immutable data class.
  No hand-written constructor, getter, `equals`, `hashCode`, or
  `toString` boilerplate. The full config model fits in roughly 200
  lines of record declarations rather than ~600 lines of hand-written
  classes.
- **Sealed interfaces** for the `RuntimeRoute` and `Observation`
  hierarchies. Compile-time exhaustiveness on switch expressions
  catches missing variants at build time, not at runtime.
- **Pattern matching for `switch`** lets dispatch over sealed types
  collapse from visitor classes to a few lines per case.
- **Virtual threads** (project Loom) eliminate the tension between
  small-bounded worker pools (cheap, but hard cap on parallelism) and
  large pools (high overhead). Blocking work runs on cheap user-mode
  threads while the snapshot semaphore still enforces fail-fast
  resource limits.
- **`java.net.http.HttpClient`** is mature, with HTTP/2 multiplexing,
  async APIs, and a small dependency footprint. Fire Horse uses it
  for buffered (non-streaming) upstream calls and reserves Netty's
  client only for SSE relays where per-stream backpressure control
  matters.
- **GraalVM native-image** AOT compilation is well-supported on Java
  17+. Fire Horse can ship as a static native binary with no JIT
  warmup, which collapses Java's main latency disadvantage relative
  to Rust Horse on cold start.
- **`var`**, switch expressions, and text blocks make the code
  shorter and more readable than older-Java equivalents.

The deployment ask is real but proportional. A user choosing Fire
Horse can run `apt install openjdk-21-jdk` (or the platform
equivalent) once. Smx's distribution strategy can also bundle a
stripped JRE via `jlink` or ship a GraalVM-compiled native binary, so
even the install step can be hidden if desired (see §5.4). And if
JDK 21 isn't available at startup for any reason, smx falls back to
Manatee with a warning rather than refusing to run.

### 5.2 Class skeleton (Java 21 idioms)

Every name in the existing TS hot path corresponds to a Fire Horse
class or method. Names are kept suggestive of their TS counterparts.

#### 5.2.1 Lifecycle and ownership

- `FireHorseServer` — top-level, one instance per process. Owns the
  HTTP listener, the active configuration snapshot (held via a
  `volatile` field for atomic swap), the upstream client, the
  observation emitter, and the stdin command listener.
  - `start(FireHorseConfigSnapshot)` — bind, listen, install shutdown
    hooks.
  - `reload(FireHorseConfigSnapshot next)` — atomic snapshot swap.
    In-flight requests keep using the old snapshot they captured at
    entry.
  - `drain(Duration grace)` — stop accepting new connections, wait
    up to `grace` for in-flight requests, then forcibly close.
  - `shutdown()` — drain plus release the port.
  - `currentSnapshotId()` — for control-plane diagnostics.
- `StdinCommandListener` — reads framed commands (`RELOAD`, `DRAIN`,
  `SHUTDOWN`, `STATUS`) from `System.in` on a dedicated virtual
  thread and dispatches. Effectively serialized via a single worker.

#### 5.2.2 Configuration

```java
public record FireHorseConfigSnapshot(
    String bindHost,
    int port,
    int maxConnections,
    InboundAuthState inboundAuthState,
    FailedAuthLimitPolicy failedAuthLimitPolicy,
    RateLimit rateLimit,
    int jsonParseSlots,
    int streamingSlotsPerIp,
    Map<String, RouteEntry> routes,
    long bodySizeLimitBytes,
    Duration bodyReadIdleTimeout,
    Duration bodyReadTotalTimeout,
    UpstreamTimeouts upstreamTimeouts,
    DnsPinPolicy dnsPinPolicy,
    String logLevel,
    RedactionPolicy redactionPolicy,
    ApiSurfaces apiSurfaces,
    Optional<CorsPolicy> corsPolicy,
    Instant processStartedAt,
    Instant snapshotLoadedAt,
    String snapshotId
) { }

public record RouteEntry(
    ApiMode apiMode,
    UpstreamConfig upstream,
    String upstreamModelId,
    Optional<CostConfig> costConfig,
    Optional<UpstreamTimeouts> perRouteTimeouts
) { }
```

Records give automatic constructor, accessors, `equals`, `hashCode`,
and `toString` for free. `InboundAuthState`, `RedactionPolicy`,
`ApiSurfaces`, etc. are all records too.

`SecretRef` is the indirection through which the snapshot references
API keys. The raw bytes live in a separate `SecretMaterializer` so
the snapshot can be safely serialized for status views without
leaking secrets — mirrors `MaskedSecret` / `SecretString` on the TS
side.

#### 5.2.3 Request entry, auth, rate limit

- `HttpFrontend` — Netty pipeline. One Netty event-loop group for
  accept + read; the per-request handler is a `ChannelHandler` chain
  to keep allocation low. Netty remains the right choice for the
  *server* side because of its precise control over backpressure and
  buffer reuse on the SSE relay; the *client* side can be lighter
  (see `UpstreamHttpClient` below).

- `RequestRouter` — pure dispatch on `(method, pathname)`:

  ```java
  public sealed interface RuntimeRoute {
      record Health() implements RuntimeRoute {}
      record DataPlane(boolean isAnthropic) implements RuntimeRoute {}
      record RuntimeConfigRead() implements RuntimeRoute {}
      record RuntimeInspectRead(String inspectId) implements RuntimeRoute {}
      record UnknownControl() implements RuntimeRoute {}
      record NotFound() implements RuntimeRoute {}
  }

  public RuntimeRoute classify(String method, String pathname) {
      return switch (pathname) {
          case "/health" when method.equals("GET")
              -> new Health();
          case "/v1/chat/completions" when method.equals("POST")
              -> new DataPlane(false);
          case "/anthropic/v1/messages" when method.equals("POST")
              -> new DataPlane(true);
          // ...
          default -> new NotFound();
      };
  }
  ```

  Sealed interfaces plus pattern-matching `switch` give compile-time
  exhaustiveness without visitor boilerplate.

- `RequestId` — per-request UUID, written to the response as
  `x-switchmaxxer-request-id` and propagated to observations.
- `InboundAuthGate` — bearer / loopback rules; timing-safe token
  compare via `MessageDigest.isEqual`.
- `FailedAuthLimiter` — per-source-IP exponential backoff after
  failed inbound auth attempts. The "source" is an *inbound client*
  — an app hitting Fire Horse's listening port — not an upstream
  service provider. A "failure" is a client presenting a wrong,
  expired, or missing inbound auth token; the limiter tracks failures
  keyed by the IP of the TCP peer at Fire Horse's listening socket
  and applies exponential backoff so a brute-force scan from a single
  IP can't keep guessing tokens cheaply. Upstream provider errors
  (Anthropic returning 401, OpenAI rate-limiting Fire Horse) never
  feed this limiter; those are handled in `UpstreamHttpClient` and
  `ErrorClassifier`. Internally a `ConcurrentHashMap<String,
  BackoffState>` with periodic eviction.
- `CallerRateLimiter` — windowed counter keyed by
  `<sourceIp>:<trustClass>`. `sourceIp` is the *inbound* client IP —
  the remote address of the TCP connection arriving at Fire Horse's
  listening port (`channel.remoteAddress()` on Netty). It is the IP
  of the app calling Fire Horse, not an upstream provider IP. If
  Fire Horse sits behind a trusted reverse proxy, `sourceIp` may
  optionally be derived from `X-Forwarded-For` when the snapshot
  explicitly enables that trust; by default Fire Horse uses the
  TCP-level peer so a misconfigured front proxy can't be tricked
  into spoofing the limiter. The `trustClass` half of the key
  separates data-plane traffic from control-plane reads.
- `JsonParseSlots` — semaphore (`tryAcquire`); on full, return 503
  immediately. *Never queue.*
- `StreamingSlotsPerIp` — `ConcurrentHashMap<String, AtomicInteger>`;
  on full, return 429.

#### 5.2.4 Data plane

```
  request -> bodyReader.readWithLimit(snapshot.bodySizeLimitBytes(),
                                       snapshot.bodyReadIdleTimeout(),
                                       snapshot.bodyReadTotalTimeout())
          -> jsonParser.parseUnderSlot(snapshot.jsonParseSlots())
          -> requestShapeValidator.validate(apiMode, parsed)
          -> routeResolver.resolve(parsed.model, snapshot.routes())
          -> apiModeCompatibilityCheck(route.apiMode(), listenerSurface)
          -> requestTranslator.translate(parsed, route)
          -> upstreamClient.send(translatedRequest, route, timeouts)
          -> if streaming:
                streamingRelay.pipe(upstreamResponse, clientResponse)
             else:
                bufferedResponseAssembler.assemble(upstreamResponse)
                  -> responseTranslator.translate(...)
                  -> clientResponse.write(...)
```

- `RequestBodyReader` — bounded reader with idle/total timeouts.
- `RequestShapeValidator` — separate `OpenAi` and `Anthropic`
  implementations; preserves unknown fields for round-tripping.
- `RouteResolver` — `snapshot.routes().get(bareModel)`; fails with
  `route_not_found` on miss.
- `ApiModeCompatibilityChecker` — listener-surface ↔
  `route.apiMode()`.
- `OpenAiToAnthropicTranslator`, `AnthropicToOpenAiTranslator` — JSON
  tree walks. The hot path uses **Jackson Streaming API** rather than
  `ObjectNode` to avoid intermediate allocations; pattern matching
  over a sealed `JsonShape` ADT collapses the dialect-rewriting cases
  from a visitor into a `switch` expression. Bidirectional. Each
  implements request, response, and SSE-event translation. This is
  still the largest single piece of Fire Horse code, but at modern
  Java idioms it's roughly the same line-count as the TypeScript
  equivalent.
- `UpstreamHttpClient` — wraps **`java.net.http.HttpClient` for
  buffered upstream calls** and **Netty's HTTP/2 client for
  streaming**. The split is deliberate: the JDK client is simpler and
  has zero extra dependencies, but its streaming model is less
  flexible than Netty's; the streaming relay needs Netty's auto-read
  and per-event backpressure. Per-route timeouts, idempotency-key
  handling, and DNS pinning are implemented uniformly across both
  clients.
- `UpstreamUrlBuilder`, `UpstreamHeaderRewriter`.
- `StreamingRelay` — SSE pipe with idle/lifetime timeouts, byte caps,
  rate-of-progress monitoring, backpressure (Netty auto-read off when
  downstream is slow), abort propagation.
- `BufferedResponseAssembler` — non-streaming reader with byte cap.
- `ErrorClassifier` — upstream-error → canonical classification.
- `ErrorEnvelopeWriter` — produces the JSON error envelope
  byte-stable with `response-envelope` / `error-detail-sanitizer`
  shapes (clients depend on it).

#### 5.2.5 Control plane (read-only), health, observation

- `RuntimeConfigReadHandler` — serializes a redacted view of
  `currentSnapshot`. Output is byte-stable so existing
  `smx gateway status` parsers keep working.
- `InvokeInspectionCaptureStore` — bounded ring buffer of recent
  inspection captures keyed by request id. New captures overwrite
  oldest.
- `RuntimeInspectReadHandler` — looks up by id, applies
  `include_secrets` token gating, returns the capture as JSON.
- `HealthHandler` — synchronous; returns 200 if the listener is up
  and the snapshot is non-fatal, 503 otherwise.
- `ObservationEmitter` — bounded ring buffer + a single virtual
  thread draining to fd 3. If the buffer fills, drops *observations*
  and counts them rather than blocking the data plane.
- `Observation` — sealed interface with record subtypes:

  ```java
  public sealed interface Observation
      permits RequestStarted, RequestCompleted, UpstreamError,
              RateLimitDecision, AuthDecision,
              InvokeInspectionCaptured, ConfigSnapshotApplied,
              SnapshotReloadFailed, BackpressureSignal {}

  public record RequestCompleted(
      String requestId,
      Duration latency,
      int status,
      String routeKey,
      Optional<String> upstreamRequestId
  ) implements Observation {}
  // ...
  ```

  The sealed declaration gives compile-time exhaustiveness on
  serialization, redaction, and ledger-write dispatch.
- `SecretRedactor` — applied before any field crosses the observation
  channel. The TS `secret-redaction` rules port directly.

### 5.3 Threading and backpressure

The hardest semantic to preserve is "fail fast, never queue":

- JSON parse pool full → 503, not enqueued.
- Streaming slots full → 429, not enqueued.
- Upstream timeout → error envelope, no retry from the hot path.
- Observation buffer full → drop, do not block the request.

JDK 21 makes this discipline easier without changing the contract:

- Netty event-loop accepts and reads. Same as before.
- Body parse runs on **virtual threads**, gated by a
  snapshot-versioned semaphore. Virtual threads cost almost nothing
  to create (~kilobytes of stack each), so the previous tension
  between "small bounded pool" (cheap, but hard cap on parallelism)
  and "large pool" (high overhead) dissolves. The semaphore still
  enforces the JSON parse slots limit — that limit exists to bound
  CPU and memory consumed by concurrent parses, not threads — but
  the threads themselves are no longer the constraining resource.
- Upstream IO runs on Netty event loops for streaming requests and
  on virtual threads (with `HttpClient`'s blocking API) for buffered
  ones. The non-async path no longer costs an OS thread per request,
  which simplifies the upstream-client code substantially.
- Streaming relay runs on the event loops with auto-read backpressure.
- The observation emitter runs on a single virtual thread that drains
  the ring buffer to fd 3.

This shape preserves the fail-fast contract bit-for-bit while leaning
on virtual threads for the parts that older Java designs had to
tiptoe around. The JVM's modern garbage collectors (G1 by default,
ZGC available with `-XX:+UseZGC` for sub-millisecond pauses) keep
tail latency well-behaved under load.

Buffer sizes are derived from snapshot fields, not hard-coded.
Reload must be able to grow or shrink them at runtime; the cleanest
approach is snapshot-versioned semaphores so in-flight requests
drain on the old slots while new requests acquire on the new ones.

### 5.4 Fire Horse's character

- **Higher per-request CPU efficiency than Manatee** for translation-
  heavy and SSE-heavy workloads. Modern JIT plus virtual threads plus
  ZGC give Fire Horse the perf profile of a JVM gateway tuned for
  this workload.
- **JIT warmup tax exists in HotSpot mode** (~10k requests slow
  before steady state) and **disappears in native-image mode**:
  GraalVM AOT-compiles Fire Horse to a static binary that runs at
  full speed from request 1, collapsing one of Java's traditional
  weaknesses against Rust Horse on cold start.
- **Verbosity is on par with TypeScript** at modern idioms. Records,
  sealed interfaces, pattern matching, switch expressions, `var`,
  and virtual threads together close the gap that Java 8 left wide
  open. The translation pass is no longer measurably more verbose
  than the TS or Rust equivalents.
- **Distribution options:**
  - **User-installed JDK 21.** Lowest distribution effort for smx;
    user runs `apt install openjdk-21-jdk` (or `brew install
    openjdk@21`, etc.) once. Reasonable for an opt-in performance
    mode.
  - **Bundled JRE via `jlink`.** Smx ships a stripped Java 21 runtime
    (~30–50 MB per platform) so users install nothing.
  - **GraalVM native-image.** Smx ships a static native binary
    (~25–40 MB per platform), no runtime to install, no JIT warmup.
    Reflection requires explicit configuration; Netty has good
    native-image support; Jackson Streaming works with reachability
    metadata.
- **Graceful fallback.** If the chosen distribution mode is
  unavailable at startup (no `java` on PATH, missing native binary
  for the platform), smx falls back to Manatee with a warning rather
  than refusing to start.

LOC: at JDK 21 idioms with Netty (server) + `java.net.http.HttpClient`
(buffered upstream) + Jackson Streaming, **approximately 12,000 LOC
of Java**. Records eliminate ~3–4k lines of data-class boilerplate
versus Java 8; sealed interfaces and pattern matching collapse
another ~500 lines of visitor dispatch; virtual threads remove a
layer of pool-management code worth maybe ~200 lines. The result is
roughly the same line-count as the TS hot path — for the first time,
Java is not paying a verbosity tax for the same logic.

## 6. Rust Horse — Out-of-Process Rust

Rust Horse is a native Rust binary spawned and supervised by smx, owning
the data port the same way Fire Horse does. The architecture is identical:

```
       ┌─────────────────────┐               ┌──────────────────────┐
       │  smx (Node)         │               │  Rust Horse          │
       │                     │     stdin     │  (native binary)     │
       │  control client ────┼───────────────┼─► commands           │
       │  control client ◄───┼─── stdout ────┼── replies            │
       │  obs consumer  ◄────┼─── fd 3 ──────┼── observations       │
       │  log tee       ◄────┼─── stderr ────┼── panics / logs      │
       └─────────────────────┘               └──────────┬───────────┘
                                                        │ TCP : 4080
                                              ┌─────────┴─────────┐
                                              │                   │
                                          inbound            outbound
                                          clients         upstream API
```

### 6.1 Component shape

The component breakdown maps one-to-one to Fire Horse's, but with
language-native equivalents:

- `HttpFrontend` → `hyper` server with Tokio runtime
- `UpstreamHttpClient` → `hyper` client with HTTP/2 multiplexing
- `OpenAi*Translator` / `Anthropic*Translator` → `serde_json` walks,
  ideally with `RawValue` borrowing for zero-copy paths
- `JsonParser` → `simd-json` or `sonic-rs` for the hot parse path
- `RequestRouter`, `InboundAuthGate`, `FailedAuthLimiter`,
  `CallerRateLimiter`, `StreamingRelay`, etc. → idiomatic Rust
  equivalents

The framing layer for stdin/stdout/fd 3 is built from `tokio::io` plus
a small length-prefix codec.

### 6.2 Rust Horse's character

- **No JIT warmup.** Full speed from request 1.
- **No GC pauses.** Tail latency tracks median much more tightly than
  either TS or Java.
- **Smaller memory footprint.** A long-lived SSE stream costs a fraction
  of what it does on the JVM, and orders of magnitude less than on Node.
- **AOT static binary.** No runtime dependency to install on the user's
  box; smx ships a per-platform Rust Horse binary alongside the JS.
- **Higher development cost.** A Rust port is roughly 1.5–2× the
  engineering effort of a Java port at equal scope, mostly because
  lifetime discipline on a JSON tree you also want to mutate is the
  hardest part of the job.

LOC: idiomatic Rust with `hyper` + `serde_json` + `simd-json`,
**approximately 9,000 LOC of Rust**. Denser than Java even at modern
idioms; smaller still than Java 1.8.

## 7. The Three Implementations Compared

|                                       | Manatee          | Fire Horse (Java 21)            | Rust Horse           |
|---------------------------------------|------------------|----------------------------------|-----------------------|
| **Process model**                     | in-process       | child process                    | child process         |
| **Owns the data port**                | smx does         | yes                              | yes                   |
| **Per-request IPC tax**               | none             | none (data plane direct)         | none (data plane direct) |
| **Observation channel**               | AsyncIterable    | fd 3 framed pipe                 | fd 3 framed pipe      |
| **Cold start / JIT warmup**           | none             | HotSpot: ~10k slow / native-image: none | none           |
| **GC pauses on tail**                 | V8 (small)       | ZGC sub-ms / G1 small-ms         | none                  |
| **Crash isolation from smx**          | none             | yes                              | yes                   |
| **Distribution requirement**          | nothing          | user JDK 21, bundled JRE, or native-image binary | bundled native binary |
| **Hypothetical p50 (vs 100 ms TS)**   | ~100 ms (today)  | ~55 ms (HotSpot warm) / ~50 ms (native-image) | ~30 ms     |
| **Hypothetical p99 (vs 250 ms TS)**   | ~250 ms          | ~65 ms with ZGC                  | ~35 ms                |
| **LOC estimate (no tests)**           | ~9,000 TS        | ~12,000 Java                     | ~9,000 Rust           |
| **Always-available default**          | yes              | no                               | no                    |

## 8. Selection and Fallback

```jsonc
"hotPath": {
  "kind": "manatee",                         // or "firehorse" / "rusthorse"
  "binary": "/optional/override/path",       // for firehorse / rusthorse
  "fallback": "manatee"                      // when chosen kind is unavailable
}
```

Selection logic at smx startup:

```
┌─────────────────────────────────────────────────────────┐
│ smx start                                               │
│   │                                                     │
│   ├─ read config.hotPath.kind                           │
│   │                                                     │
│   ├─ if "manatee":                                      │
│   │     instantiate Manatee  ─────────────────▶ ready   │
│   │                                                     │
│   ├─ if "firehorse":                                    │
│   │     locate JVM + jar                                │
│   │     ├─ found:    spawn, wait for handshake ──▶ ready│
│   │     └─ missing:  log warning, fall back to Manatee  │
│   │                                                     │
│   └─ if "rusthorse":                                    │
│         locate native binary for platform               │
│         ├─ found:    spawn, wait for handshake ──▶ ready│
│         └─ missing:  log warning, fall back to Manatee  │
└─────────────────────────────────────────────────────────┘
```

The principle: **smx never refuses to start because of an unavailable
out-of-process implementation.** Manatee is always there as the floor.

## 9. What This Buys, What It Costs

**What it buys:**

- A clean separation between "how requests are processed" and "what smx
  does." The hot path is a pluggable subsystem.
- Performance options without forking the project. Users who want the
  fastest possible gateway pick Rust Horse; users who want JVM-shop
  alignment pick Fire Horse; users who want zero install friction stay
  on Manatee.
- A testable specification. The same conformance suite runs against all
  three implementations; deltas surface as test failures rather than as
  whispered behavior.
- A path to evolve smx and the hot path independently. Smx can ship
  config or CLI changes without coordinating with Fire Horse / Rust
  Horse releases (until the contract changes).

**What it costs:**

- Three implementations of the same logic to keep in step. Even with
  Manatee as the spec, drift is real and CI must catch it.
- A versioned contract. Once Fire Horse or Rust Horse ships, the
  `HotPath` interface and its wire derivation become a published API
  with all that implies for compatibility.
- The carving-out work to extract Manatee from smx is non-trivial
  (1–2k lines of glue). It earns its keep regardless, but it has to be
  done before any of this becomes coherent.
- Distribution complexity for the out-of-process implementations. Each
  needs a per-platform binary in the smx package or a documented user
  install path. Bundled JREs and AOT binaries each have their own
  build-pipeline cost.

## 10. The Smallest Viable First Cut

The right starting point is *not* shipping all three. It is:

1. **Carve Manatee out of smx.** Define the `HotPath` interface, refactor
   the existing TS hot path to implement it, replace the in-process
   call sites in smx with calls through the interface. This single step
   gets you a swappable subsystem with no behavior change.
2. **Add a frame-based adapter for whichever non-TS implementation comes
   first.** The wire derivation pattern (control via stdin, replies via
   stdout, observations via fd 3) is the same regardless of the
   target language; building the adapter once benefits every
   subsequent language port.
3. **Pick Fire Horse or Rust Horse based on team capacity and goal.**
   Fire Horse is faster to write but slower at runtime (and tied to
   the JVM). Rust Horse is slower to write but faster at runtime and
   ships as a single static binary.
4. **Treat the third implementation as optional.** If Fire Horse or
   Rust Horse delivers enough value, the other may never be worth
   building. The architecture admits it; the team isn't obligated to
   provide it.

Everything else — Anthropic surface, SSE, DNS pinning, invoke inspection,
graceful drain, hot reload, secret rotation — is added in layers on
whichever implementation is being worked on. Manatee implements them
first because the source of truth is TS; Fire Horse and Rust Horse
follow.

## 11. Closing Note

The reason the current TS hot path is small is that the cold path stayed
out of it. The reason this factoring is interesting is the same: if smx
keeps its hands off the request bytes, the hot path can be ruthlessly
minimal — and once it's minimal and behind a contract, the language it's
written in becomes a deployment-time choice rather than a codebase-defining
one.

The interesting design work isn't writing the Java or the Rust. It's
drawing the contract between smx and the hot path sharply enough that
three implementations can coexist without becoming three codebases.
Manatee earns its keep as the reference: it is the implementation that's
always right, against which the others are diffed. Fire Horse and Rust
Horse earn their keep on perf — but only on workloads where the IPC-free
data-plane architecture lets their language advantage show through.

The thing to avoid is shipping pluggability infrastructure with one
implementation behind it and calling it future-proof. Pluggability earns
its keep when there are at least two real implementations on the other
side of the seam. Until then, the work is to build the contract well —
in TypeScript, with Manatee as both the first implementation and the
spec.

## 12. Glossary

Technical terms used in this document, grouped for scannability.

### Implementations and contracts

- **Adapter** — a smx-side TypeScript object that implements the
  `HotPath` interface but routes calls to an out-of-process child
  rather than executing them directly. `FireHorseAdapter` and
  `RustHorseAdapter` are the two adapters defined here; Manatee has
  no adapter because it runs in-process.
- **Cold path** — the parts of smx that do not run on every request:
  config CRUD, CLI surface, MCP, observability persistence,
  optimization, bench, control-plane reads. Stays in TypeScript.
- **Contract** — the `HotPath` TypeScript interface plus the rules
  governing its parameter and return types (plain-data, AsyncIterable
  observations, no back-references). The single definition of correct
  behavior shared by all three implementations.
- **Fire Horse** — the out-of-process Java 21 implementation of the
  hot path. Spawns a JVM child using Netty (server side and SSE
  client), `java.net.http.HttpClient` (buffered upstream calls), and
  Jackson Streaming (JSON), with virtual threads for blocking work
  and records / sealed interfaces / pattern matching throughout.
  Communicates with smx through framed pipes. Abbreviated `fh`.
- **Hot path** — the per-request slice of smx: HTTP framing, body
  read, JSON parse, dialect translation, route resolution, upstream
  fetch, response shaping, SSE relay. The code that runs once for
  every byte of every inbound request.
- **HotPath interface** — the TypeScript interface defining `start`,
  `reload`, `drain`, `shutdown`, `status`, and `observations`.
  Manatee, `FireHorseAdapter`, and `RustHorseAdapter` all implement
  it.
- **HotPathObservation** — a structured event emitted by the hot path
  during request processing. Sealed set of variants
  (`RequestStarted`, `RequestCompleted`, `UpstreamError`, etc.).
- **HotPathSnapshot** — the immutable bundle of fields the hot path
  needs to do its work (bind host, port, routes, timeouts, auth
  state, rate-limit policy, etc.). Delivered at `start` and at every
  `reload`.
- **HotPathStatus** — the runtime status returned by `status()`:
  in-flight requests, slot occupancy, recent error counts, snapshot
  id, fatal state.
- **Manatee** — the in-process TypeScript implementation of the hot
  path. The reference implementation: when behavior is underspecified
  by the contract, Manatee defines what's correct. Always available
  because it ships as part of smx.
- **Reference implementation** — the implementation that defines
  correctness against which other implementations are diffed. Manatee
  plays this role.
- **Rust Horse** — the out-of-process Rust implementation of the hot
  path. A native binary using `hyper` for HTTP and `serde_json` /
  `simd-json` for JSON; communicates with smx through framed pipes.
- **smx** — Switchmaxxer itself: the existing TypeScript gateway,
  CLI, and supporting subsystems. Owns config, catalog, CLI, MCP,
  observability ledger, and the lifecycle of any out-of-process hot
  path.

### Switchmaxxer concepts

- **API mode** — the dialect a route speaks (`openai` or `anthropic`).
  Determines which translator runs and which listener surfaces are
  compatible.
- **Caller rate limit** — per-source-IP rate budget keyed by
  `<sourceIp>:<trustClass>`. Decrements on every request; on exhaustion
  returns 429 with a `retry-after` header.
- **Catalog** — `catalog.json` at the repo root. Defines available
  service providers, models, and route templates. Loaded once at
  startup, merged with `config.json` into the runtime config.
- **Failed auth limiter** — exponential-backoff limiter applied to
  inbound clients (apps hitting the gateway port) that present wrong,
  expired, or missing inbound auth tokens. Slows brute-force token
  guessing from a single IP. Distinct from upstream provider auth
  errors.
- **Inbound auth** — the bearer-token check applied to clients
  arriving at the gateway port. Modes are `disabled_explicit`,
  `loopback_only`, or `token`.
- **Invoke inspection** — a per-request debug capture (request shape,
  upstream URL, headers) stored in a bounded ring buffer keyed by
  request UUID. Read by `/__switchmaxxer/runtime/inspect/<id>`.
- **MCP** — Model Context Protocol surface that smx exposes for tool
  use by Claude and other agents. Cold-path; does not enter the
  per-request hot path.
- **Observability ledger** — the persistent SQLite store smx uses to
  record request events, control-plane actions, optimization runs,
  and audit trails.
- **Route** — an entry in `config.routes` keyed by client-supplied
  model id. Carries the api_mode, upstream base URL, API key
  reference, and per-route timeouts.
- **Snapshot** — see `HotPathSnapshot`. Sometimes used loosely to
  mean the merged `config.json` + `catalog.json` view.
- **Source IP** — the IP address of the inbound TCP peer at the hot
  path's listening socket. The IP of the app calling the gateway, not
  an upstream provider IP. Optionally derived from `X-Forwarded-For`
  when the snapshot enables that trust.
- **Trust class** — the routing classification given to an inbound
  request: `health`, `data_plane`, `control_plane_read`, or `unknown`.
  Drives auth and rate-limit decisions.

### HTTP and networking

- **AF_UNIX** — Unix-domain socket address family. Cross-process IPC
  on a single host; supported on Linux, macOS, and Windows 10 build
  17063+ / Server 2019+.
- **ALB** — Application Load Balancer (typically AWS). A possible TLS
  terminator in front of the gateway.
- **Caddy** — an HTTP server with automatic TLS provisioning; another
  candidate TLS terminator.
- **DNS pinning** — caching the resolved IP for an upstream hostname
  for the duration of a request, so the connection used isn't a
  different host than the one validated. Mitigates DNS rebinding.
- **HTTP/2** — multiplexed binary HTTP transport. Lets one TCP
  connection carry many concurrent streams; relevant for upstream
  client efficiency.
- **Loopback** — the 127.0.0.1 / ::1 interface; traffic that never
  leaves the host.
- **Named pipe** — Windows IPC primitive (`\\.\pipe\name`). Functional
  analogue of an AF_UNIX socket on Windows.
- **nginx** — an HTTP server / reverse proxy commonly used as a TLS
  terminator.
- **OCSP stapling** — a TLS server-side optimization that includes
  pre-fetched certificate revocation status in the handshake. One of
  the operational concerns kept out of the hot path.
- **SNI** — Server Name Indication. The TLS handshake field that
  tells a server which certificate to present. Relevant only if the
  hot path terminates TLS.
- **SSE** — Server-Sent Events. The HTTP streaming format used for
  incremental model responses. Each event is one chunk in a
  newline-delimited stream.
- **TLS** — Transport Layer Security. The encryption protocol
  underlying HTTPS. The hot path does not terminate it; a fronting
  proxy does.

### Process and IPC

- **CBOR** — Concise Binary Object Representation; a compact binary
  alternative to JSON. Candidate frame payload encoding for the
  observation channel.
- **Control channel** — the stdin/stdout pair through which smx pushes
  commands (`RELOAD`, `DRAIN`, `SHUTDOWN`, `STATUS`) to an out-of-process
  hot path and reads replies.
- **fd 3** — the fourth file descriptor (after stdin=0, stdout=1,
  stderr=2). An additional pipe set up at spawn time, dedicated here
  to the observation channel for out-of-process implementations.
- **File descriptor (fd)** — an integer handle into a process's
  open-file table. The kernel-level identity of an open file, socket,
  pipe, or device.
- **Length-prefixed framing** — the message-boundary scheme used here:
  a 4-byte big-endian length followed by a JSON or CBOR payload. Lets
  the reader recover frame boundaries without parsing the payload.
- **Observation channel** — the fd 3 pipe through which an
  out-of-process hot path streams `HotPathObservation` events to smx.
  Unidirectional, framed.
- **Ring buffer** — a fixed-capacity circular buffer that never blocks
  a writer. When full, drops the newest entry (with a counter
  increment) or overwrites the oldest. Used here for in-memory
  observation buffering.
- **STARTUPINFO** — the Windows API structure passed at process
  creation that controls handle inheritance. How fd 3 gets propagated
  to a child on Windows.
- **stdin / stdout / stderr** — the three file descriptors every
  process starts with: 0 for input, 1 for normal output, 2 for
  diagnostic output.
- **Stdio framing** — the IPC pattern of writing length-prefixed
  framed messages over stdin/stdout (and additional pipes) of a
  spawned child. Adopted here for the control channel.

### Concurrency and threading

- **Backpressure** — the propagation of slow-consumer signals back to
  the producer so the producer slows down rather than buffering
  unboundedly. Netty's auto-read off and Tokio's poll model both
  implement this.
- **Bounded queue** — a queue with a fixed capacity. Combined with
  fail-fast on full, prevents unbounded latency growth under load.
- **Event loop** — single-threaded async dispatcher. Node's runtime,
  Netty's `EventLoopGroup`, and Tokio's runtime all expose one.
- **Fail-fast** — the policy of rejecting work immediately when a
  resource is unavailable rather than queueing it. Preserved across
  all three implementations: 503 on JSON parse slot exhaustion, 429
  on streaming slot exhaustion.
- **Semaphore** — a counter-based concurrency primitive that allows
  N permits to be held simultaneously. `tryAcquire` is the
  non-blocking variant used here for slot enforcement.
- **Worker pool** — a fixed-size set of threads servicing a bounded
  queue of work. Used in Fire Horse for the (small) blocking JSON
  parse step.

### Java-specific (JDK 21)

- **AtomicInteger** — `java.util.concurrent.atomic.AtomicInteger`.
  Lock-free counter; used for streaming-slot accounting.
- **ChannelHandler** — Netty's per-connection callback class. The
  request-handling pipeline is a chain of these.
- **ConcurrentHashMap** — Java's lock-striped concurrent map. Used
  for the failed-auth backoff state and per-IP streaming counters.
- **Eclipse Temurin** — a popular OpenJDK distribution; the standard
  source for free-to-use JDK 21 binaries on Linux, macOS, and Windows.
- **G1** — the default Java garbage collector since Java 9. Targets
  predictable pause times in the tens of milliseconds.
- **GraalVM native-image** — AOT compiler that produces a static
  native binary from JVM bytecode. Available for JDK 17+; Fire Horse
  uses it as one distribution mode to ship as a single binary with no
  JIT warmup.
- **HotSpot** — the standard JVM execution engine that interprets
  bytecode and uses JIT to compile hot methods to native code.
  Contrast with native-image, where compilation happens at build time.
- **Jackson** — Java's most-used JSON library. Fire Horse uses the
  **Streaming API** (`JsonParser` / `JsonGenerator`) on the hot path
  to avoid the allocation cost of building intermediate `ObjectNode`
  trees during translation.
- **java.net.http.HttpClient** — the modern JDK-bundled HTTP client,
  added in Java 11 and mature in 21. Supports HTTP/2 multiplexing,
  async APIs, and ships as part of the JDK with zero extra
  dependencies. Fire Horse uses it for buffered upstream calls.
- **JDK 21** — the LTS Java release that Fire Horse targets. Provides
  records, sealed interfaces, pattern matching for `switch`,
  switch expressions, `var`, virtual threads (project Loom), text
  blocks, and modern garbage collectors (G1, ZGC). Released 2023.
- **JIT** — Just-In-Time compilation. The JVM compiles hot bytecode
  to native machine code at runtime. In HotSpot mode the first ~10k
  requests run slower than steady state; in native-image mode there
  is no JIT and no warmup.
- **jlink** — JDK tool for assembling a stripped runtime image. Lets
  Fire Horse ship a small bundled JRE (~30–50 MB) rather than
  requiring a system JDK install.
- **Netty** — high-performance async I/O framework for the JVM. Used
  by Fire Horse for the HTTP server and for SSE-streaming upstream
  calls where per-stream backpressure matters.
- **ObjectNode** — Jackson's mutable JSON tree node. Convenient for
  cold-path JSON manipulation but allocation-heavy; Fire Horse
  avoids it on the request hot path.
- **Pattern matching for `switch`** — Java 21 feature for exhaustive
  dispatch over sealed types. Used in `RequestRouter`,
  observation-serialization, and translator dispatch.
- **Records** — Java 14+ concise immutable data class syntax. Used
  for `FireHorseConfigSnapshot`, `RouteEntry`, every `Observation`
  variant, and most other data classes — eliminates ~3–4k lines of
  boilerplate compared to a Java 8 port.
- **Sealed interfaces** — Java 17+ feature for closed type
  hierarchies enabling exhaustive pattern matching. Used here for
  `RuntimeRoute` and `Observation`, giving compile-time
  exhaustiveness checks on dispatch.
- **Switch expressions** — Java 14+ feature; switch returns a value
  and supports arrow syntax. Used throughout for dispatch.
- **Text blocks** — Java 15+ multi-line string syntax. Useful in
  tests and error messages.
- **var (local variable type inference)** — Java 10+ feature. Used
  throughout Fire Horse to remove redundant type declarations.
- **Virtual threads** — Java 21 feature (project Loom). Lightweight
  user-mode threads that allow blocking I/O without consuming an OS
  thread. Fire Horse uses them for body parsing, the stdin command
  reader, the observation emitter, and buffered upstream calls.
- **volatile** — Java keyword guaranteeing memory-ordering visibility
  for a field across threads. Used here for the atomic snapshot-swap
  reference.
- **ZGC** — the Z Garbage Collector, available in modern JDKs.
  Targets sub-millisecond pause times even on multi-gigabyte heaps,
  optionally enabled with `-XX:+UseZGC` for latency-sensitive Fire
  Horse deployments.

### Rust-specific

- **AOT compilation** — Ahead-of-Time compilation. Rust binaries are
  AOT by default; no JIT, no warmup.
- **hyper** — the dominant Rust HTTP server and client library, built
  on Tokio. Chosen for Rust Horse.
- **Lifetime / borrowing** — Rust's compile-time mechanism for
  ensuring references don't outlive their referents. The main reason
  Rust development is slower than Java; especially expensive when
  mutating JSON trees.
- **RawValue** — `serde_json::value::RawValue`. A borrowed,
  unparsed JSON fragment. Lets translation pass JSON through without
  copying or re-parsing.
- **serde** — Rust's serialization framework. `serde_json` is the
  JSON crate.
- **simd-json / sonic-rs** — SIMD-accelerated JSON parsers; faster
  than `serde_json` on the parse path. Candidates for Rust Horse's
  hot parse stage.
- **Tokio** — Rust's most-used async runtime; multithreaded
  work-stealing scheduler. The foundation under `hyper`.
- **Trait** — Rust's interface-like abstraction mechanism. How `HotPath`
  would be expressed in Rust if Rust Horse needed an internal
  abstraction.

### Performance and latency

- **Cold start** — the period after a process begins serving traffic
  before its caches, JIT, and runtime structures are warm. Java has a
  significant cold start; Rust effectively has none.
- **p50** — the median of a latency distribution; the value at which
  50% of requests are faster.
- **p99** — the 99th percentile of a latency distribution; the value
  at which 99% of requests are faster. Often dominated by GC pauses,
  scheduling, and queueing.
- **Tail latency** — the slow end of the latency distribution, usually
  expressed as p95, p99, or p999. The most user-visible latency under
  load.
- **Warmup** — the early phase of a JIT-compiled runtime during which
  hot code is profiled and re-compiled to native. Manatee has none
  beyond V8's initial parse; Fire Horse pays a real warmup cost; Rust
  Horse pays none.

### Other

- **GC (Garbage Collection)** — automatic memory reclamation. Both
  V8 (Node) and the JVM run a GC; Rust does not. GC pauses are a
  primary contributor to tail latency for the first two.
- **HTTP error codes used here:**
  - **401** — Unauthorized; bad inbound auth token.
  - **413** — Payload Too Large; body exceeded `bodySizeLimitBytes`.
  - **429** — Too Many Requests; rate or slot limit hit.
  - **503** — Service Unavailable; JSON parse slots exhausted, or
    listener fatal state.
- **Idempotency key** — an HTTP header (e.g., `Idempotency-Key`) that
  lets a client safely retry a request without producing duplicate
  side effects. Forwarded by the upstream HTTP client.
- **JSON parse slots** — the bounded count of concurrent JSON-parsing
  operations the hot path will perform (default 4). On exhaustion,
  new requests are rejected with 503 rather than queued.
- **Streaming slots per IP** — the bounded count of concurrent SSE
  streams a single source IP may hold open (default 8). On exhaustion,
  new streaming requests from that IP are rejected with 429.
