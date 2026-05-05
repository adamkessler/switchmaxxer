# Understanding The Model Context Protocol

An educational paper for the Switchmaxxer community

## Reader Promise

This paper explains the Model Context Protocol, or MCP, in clear language.

The reading level is meant to stay close to eighth grade. The ideas are still
serious. MCP is a real protocol used by real AI systems. So this paper avoids
jargon when it can, but it does not skip the hard parts.

Switchmaxxer is used as a running example and case study. The goal is not to
sell Switchmaxxer. The goal is to use one real project to make MCP easier to
see, test, and reason about.

## The Short Version

MCP is a standard way for AI apps to connect to outside abilities.

Those outside abilities can include:

- reading useful data
- calling tools
- showing prompt templates
- asking for user approval
- using safe boundaries around files and secrets

Before MCP, each AI app often needed a custom connection to each tool or data
source. That does not scale well. Every app had to learn every tool in a
different way.

MCP changes the shape of the problem.

Instead of:

```text
Every AI app learns every tool in a custom way.
```

MCP says:

```text
AI apps and tool servers speak one shared protocol.
```

That is the big idea.

## Why MCP Exists

AI models are strong at language, planning, and pattern matching. But by
themselves, they do not know your private files, current logs, local config, or
live systems. They also cannot safely take action unless an application gives
them a controlled way to do it.

People quickly found the same problem in many places:

- A coding assistant needs access to project files.
- A support bot needs access to tickets.
- An operations assistant needs access to logs and health checks.
- A data agent needs access to database schemas.
- A local AI workflow needs access to tools that run on the user's machine.

Without a shared standard, each connection becomes custom work.

MCP gives the industry a common pattern:

- a host runs the AI app
- a client connects that host to one server
- a server offers focused abilities
- the messages use JSON-RPC
- the host decides what the user can see, approve, or deny

The official MCP architecture describes this as a client-host-server model.
Hosts manage clients, clients keep one session with a server, and servers expose
capabilities such as tools, resources, and prompts.

Source: [MCP Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)

## The Main Characters

MCP becomes much easier once the main roles are clear.

### Host

The host is the app the user is actually using.

Examples:

- an AI chat app
- an AI coding tool
- a desktop assistant
- an IDE
- an agent workbench

The host owns the user experience. It decides what the user sees. It usually
controls model access. It also handles user consent.

In plain words:

```text
The host is the AI app.
```

### Client

The client is the connection between the host and one MCP server.

A host may run many clients at once. Each client talks to one server. This is
important because it keeps each server separated from the others.

In plain words:

```text
The client is one managed connection from the app to one server.
```

### Server

The server provides useful abilities.

An MCP server might expose:

- tools the AI can ask to run
- resources the AI app can read
- prompts the AI app can use
- data from a local or remote system

In plain words:

```text
The server is the ability provider.
```

### Session

A session is the life of one connection between a client and a server.

During a session, the client and server can:

- initialize
- agree on capabilities
- list tools
- call tools
- exchange results
- send notifications
- close

In plain words:

```text
A session is one conversation between client and server.
```

## Why The Host Matters So Much

MCP is not just a tool-calling format. It is also a safety shape.

A server should not automatically see the whole chat. It should not
automatically see every file. It should not automatically control every other
server.

The host sits in the middle and manages those boundaries.

This means a good host should ask questions like:

- Which server is connected?
- What did the server ask for?
- Does the user need to approve this?
- Is the tool safe to call?
- Should this result be shown to the model?
- Should this resource be included in context?

This is a core MCP idea: servers provide focused abilities, but the host
protects the user and controls the whole experience.

## The Simple MCP Flow

A basic MCP session often looks like this:

1. The host starts or connects to an MCP server.
2. The client sends an `initialize` request.
3. The server answers with its protocol version and capabilities.
4. The client asks for the available tools with `tools/list`.
5. The server returns tool names, descriptions, and input schemas.
6. The AI app decides it needs a tool.
7. The client sends `tools/call`.
8. The server runs the tool and returns a result.
9. The host decides what to show to the user and the model.

That is the heart of MCP in many current systems.

## JSON-RPC: The Message Shape Under MCP

MCP messages use JSON-RPC 2.0.

JSON-RPC is a simple way to describe requests and responses using JSON.

A request has:

- `jsonrpc`
- `id`
- `method`
- `params`

Example:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

A response has:

- `jsonrpc`
- the same `id`
- either `result` or `error`

Example:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": []
  }
}
```

The `id` matters. It lets the client match each response to the request that
caused it.

A notification is like a request with no `id`. It does not expect a response.

Source: [MCP Overview](https://modelcontextprotocol.io/specification/2025-06-18/basic/index)

## Transport: How Messages Move

MCP does not require only one way to move messages. A transport is the path that
carries the messages.

Two common patterns are:

- stdio
- HTTP-based transport

### Stdio

Stdio means standard input and standard output.

This is common for local MCP servers. The host starts a process. The host writes
messages to the server's stdin. The server writes responses to stdout.

Switchmaxxer uses stdio for its MCP server:

```bash
./smx mcp serve --config /absolute/path/to/config.json
```

This is a good fit for trusted local operator workflows.

### HTTP

HTTP-based MCP can be used for remote servers. It brings a different security
model. Authorization becomes much more important because a remote endpoint may
serve many users and many clients.

The MCP authorization spec uses OAuth-style ideas for HTTP transports. For
stdio, the spec says credentials should normally come from the environment
instead.

Source: [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)

## Capabilities

Capabilities are the features a client or server says it supports.

At startup, the client and server negotiate. That means they tell each other
what they can do.

Examples of server-side capabilities include:

- tools
- resources
- prompts

Examples of client-side capabilities include:

- sampling
- roots in older MCP versions

The key idea is simple:

```text
Do not assume every MCP server supports every MCP feature.
```

A strong MCP implementation checks the announced capabilities and behaves
accordingly.

## Tools

Tools are actions the server can perform.

A tool has:

- a name
- a description
- an input schema
- a result

Tools are often the easiest MCP feature to understand because they feel like
functions.

Example tool ideas:

- `config_show`
- `gateway_health`
- `trace_list`
- `bench_run`
- `routes_create`

Switchmaxxer exposes MCP tools for config management, gateway inspection,
observability, benchmarking, and optimization.

In Switchmaxxer, a tool result is not just loose text. It is a structured
object. This is important because machines need stable shapes. A stable shape
lets a client test the result, display it, and handle errors.

## Resources

Resources are data the server can expose to the client.

A resource is usually identified by a URI.

Resources can represent things like:

- files
- database schemas
- application data
- logs
- docs

The host decides how to use a resource. It may show a list to the user. It may
let the user choose one. It may include selected resource content in the model's
context.

Source: [MCP Resources](https://modelcontextprotocol.io/specification/draft/server/resources)

Switchmaxxer does not currently expose MCP resources. That is a design choice.
It focuses its MCP surface on tools.

This is a useful lesson: a server does not need to implement every MCP feature
to be valuable. It should implement the features that match its job.

## Prompts

Prompts are reusable prompt templates that a server can offer.

A prompt might help a user start a task in a known format.

For example, a server could offer prompts like:

- "Explain this trace"
- "Create a benchmark plan"
- "Review this config change"

The host can show these prompts to the user. The user can choose one, fill in
arguments, and send it to the model.

Switchmaxxer does not currently expose MCP prompts. Its current MCP design is
more focused on operational tools.

## Sampling

Sampling means asking a model to generate text, images, audio, or another
completion.

In MCP, sampling is a client-side feature. This matters because it lets the
host keep control of model access.

The server can ask for sampling, but the host and client decide whether and how
to allow it.

Why is that useful?

Because a server may need an AI step during a tool call, but the server should
not need its own model API key. The host can remain the place where model access
is controlled.

Source: [MCP Sampling](https://modelcontextprotocol.io/docs/concepts/sampling)

Switchmaxxer does not currently use MCP sampling. This is sensible for its
current role. Switchmaxxer mostly exposes operational actions and read models.

## Roots

Roots are a way for clients to tell servers which file areas are relevant.

For example, a coding host might tell a server:

```text
This project folder is the current root.
```

Roots are guidance. They are not the same as true access control.

The MCP draft docs also show that roots are changing over time. This is a good
reminder that MCP is a living standard. Builders should track the protocol
version they support and avoid assuming draft features are permanent.

Source: [MCP Roots Draft](https://modelcontextprotocol.io/specification/draft/client/roots)

Switchmaxxer handles file boundaries in its own MCP config path rules. It does
not depend on roots for safety.

## Authorization And Trust

Authorization answers this question:

```text
Who is allowed to do what?
```

This is one of the most important MCP topics.

MCP servers can expose powerful actions. A server might read private data,
change config, run benchmarks, or call paid APIs. So a good MCP system must
think carefully about trust.

### Local Stdio Trust

For local stdio servers, the trust model often depends on the host process and
the local user account.

The server usually gets secrets from:

- environment variables
- local config
- a local secrets file

This is how Switchmaxxer works. The MCP server is a local operator surface. It
is not treated as a public network API.

### HTTP Trust

For HTTP-based MCP servers, authorization is more formal. The official MCP
authorization spec uses OAuth-style flows and protected resource metadata.

This matters because remote servers can serve many users. The server must know
which user is calling and what that user may do.

### Consent

Consent means the user agrees to an action.

Consent is not the same as authorization.

Authorization says:

```text
This caller may call this tool.
```

Consent says:

```text
The user understands and approves this action now.
```

Good MCP hosts should support both.

## The Difference Between Protocol Errors And Tool Errors

This is a subtle but important lesson.

A protocol error means the MCP message itself failed.

Examples:

- invalid JSON
- unknown method
- bad JSON-RPC shape
- wrong request type

A tool error means the MCP message was valid, but the requested tool could not
complete its domain task.

Examples:

- config file not found
- route does not exist
- provider auth is missing
- gateway is unavailable
- benchmark input is invalid

Switchmaxxer uses JSON-RPC errors for protocol-level problems. It uses
structured tool envelopes for domain-level success and error results.

That split is healthy.

It lets a client say:

```text
Did the protocol fail, or did the tool return a real business error?
```

## Switchmaxxer Case Study

Switchmaxxer is a lightweight routing gateway for AI requests. It can route
requests to different providers, expose gateway health, keep observability data,
and help operators inspect or tune behavior.

Its MCP server lets an MCP client work with these surfaces through a stable
local protocol.

The current Switchmaxxer MCP server supports:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

It exposes tools for:

- config schema and validation
- models
- providers
- routes
- gateway health and status
- traces
- observation stats
- repair
- pruning
- audit ledger reads
- benchmark history and runs
- optimization history and actions

Switchmaxxer does not currently expose:

- MCP resources
- MCP prompts
- streaming tool results
- HTTP MCP transport
- MCP sampling

That is not a weakness. It is a clear scope.

Good MCP design is not about turning on every feature. It is about exposing the
right features with the right safety model.

## Switchmaxxer MCP Launch Pattern

A local Switchmaxxer MCP server can be launched with:

```bash
./smx mcp serve --config /absolute/path/to/config.json
```

An MCP client often stores a server entry like this:

```json
{
  "command": "/absolute/path/to/switchmaxxer/smx",
  "args": [
    "mcp",
    "serve",
    "--config",
    "/absolute/path/to/switchmaxxer/config.json"
  ],
  "env": {
    "SWITCHMAXXER_OBSERVABILITY_DB": "/absolute/path/to/switchmaxxer/.switchmaxxer/observability.sqlite"
  }
}
```

The command starts the server. The args tell it to serve MCP. The config path
tells it which Switchmaxxer config to use. The environment can point to a
specific observability database.

For more practical launch details, see:

[How To Launch Switchmaxxer MCP](../subsystems/mcp/how-to-launch-switchmaxxer-mcp.md)

## Switchmaxxer Capability Tiers

Switchmaxxer uses capability tiers in config.

A simple read-only policy looks like this:

```json
{
  "mcp": {
    "capabilities": ["read"]
  }
}
```

Full local operator access looks like this:

```json
{
  "mcp": {
    "capabilities": ["read", "mutation", "privileged"]
  }
}
```

These tiers matter.

Read access can inspect. Mutation access can change. Privileged access can
reach more sensitive operational surfaces.

A serious MCP server should not treat all tools as equal. A read-only tool and
a config-changing tool are not the same risk.

## A Walk Through One Switchmaxxer MCP Tool

Imagine a user asks an AI app:

```text
Is my Switchmaxxer gateway healthy?
```

The host may decide to call a Switchmaxxer MCP tool.

The flow can look like this:

1. The host has already started `smx mcp serve`.
2. The client asks for the tool list.
3. The server reports a tool named `gateway_health`.
4. The host or model chooses that tool.
5. The client sends `tools/call` with the tool name.
6. Switchmaxxer checks the gateway health endpoint.
7. Switchmaxxer returns a structured result.
8. The host shows a clear answer to the user.

The user does not need to know JSON-RPC. The model does not need to know how to
probe the gateway directly. The MCP server provides a safe, known path.

## A Walk Through One Mutation Tool

Now imagine a user asks:

```text
Add a new route for this provider model.
```

This is more sensitive.

Creating a route changes config. That means the host should treat it as a
mutation.

A safe flow should include:

1. The server only exposes route mutation tools if the config grants mutation.
2. The tool input must match a schema.
3. The server validates the route.
4. The server rejects unknown or unsafe fields.
5. The host may ask the user for approval.
6. The server writes the config.
7. The server returns a structured result.
8. The change can be audited.

This is where MCP becomes more than "function calling." It becomes a controlled
operator surface.

## A Walk Through Observability

Observability means being able to see what happened.

Switchmaxxer can store traces, observations, benchmark runs, optimization
history, and audit events.

Through MCP, a client can ask questions like:

- Which requests failed?
- What route was used?
- Which provider was called?
- What was the failure stage?
- What benchmark runs exist?
- What config changes were made?

This turns MCP into a way for an AI assistant to help explain system behavior.

But again, access matters. Some observability data may reveal sensitive
operational details. Good tool design keeps secrets masked and grants bounded.

## Input Schemas

An input schema tells the client what a tool accepts.

This is important because language models can produce messy or wrong input.

A schema can say:

- this field is required
- this value must be a string
- this value must be one of these options
- unknown fields are not allowed

Without schemas, tools become guesswork.

With schemas, the host and model have a clearer contract.

Switchmaxxer treats this seriously. Its MCP parsers reject unknown fields and
preserve typed error codes for invalid input.

## Secret Handling

Secrets are values that must not leak.

Examples:

- API keys
- bearer tokens
- credentials
- private file paths in some contexts

MCP servers must be careful because tool results may be shown to a model or a
user. Once a secret is placed in model context, it may be hard to control.

Switchmaxxer keeps provider API keys masked. It does not return raw provider
secrets through MCP config read tools.

A strong MCP server should follow rules like these:

- never return raw secrets unless there is a very specific, user-approved need
- prefer environment variable names over secret values
- redact sensitive logs
- avoid putting secrets in error messages
- test secret redaction

## Filesystem Boundaries

Filesystem access is a common MCP risk.

An MCP server may read files. That can be useful. It can also be dangerous.

Questions to ask:

- Which directories can the server read?
- Can paths escape the project folder?
- Can symlinks point outside the safe area?
- Can the server read arbitrary absolute paths?
- Are config files world-readable?

Switchmaxxer uses a stricter config path boundary for MCP than for its general
CLI. That is a good teaching point.

The human CLI is flexible because a human operator is typing commands. The MCP
surface is machine-facing, so it uses tighter rules.

## Stdio Framing

Switchmaxxer's MCP server uses newline-delimited JSON over stdio.

That means each JSON-RPC message is written as one line.

One line equals one frame.

Example:

```text
{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}
```

Then a newline ends the frame.

This sounds small, but it matters. A stdio server is reading a byte stream. It
needs a way to know where one message ends and the next begins.

Switchmaxxer's MCP spec separates:

- frame
- message
- session

That is a strong design habit. It keeps transport problems separate from
message problems and session lifecycle problems.

## Error Design

A good MCP server should make errors useful.

Bad error:

```text
Failed.
```

Better error:

```json
{
  "ok": false,
  "error": {
    "code": "gateway_unavailable",
    "message": "Gateway test preflight failed."
  }
}
```

The better error gives clients a stable code. A UI can show a good message. A
test can check the code. An AI assistant can explain the problem.

Switchmaxxer uses this kind of envelope for many tool results.

## Testing MCP

MCP testing should cover more than happy paths.

Important tests include:

- startup works
- `initialize` works
- `tools/list` returns the expected tools
- read-only grants hide mutation tools
- mutation grants expose mutation tools
- invalid JSON is handled
- malformed JSON-RPC is rejected
- unknown tools return stable errors
- unknown input fields are rejected
- secrets are redacted
- long-lived sessions remain healthy
- bad frames do not always kill the session

Switchmaxxer has shell tests and unit tests for these concerns.

This is part of why it is useful as a case study. It shows MCP as an operating
surface, not only as a demo.

## Common Mistakes

### Mistake 1: Treating MCP As Just Function Calling

Tools are important, but MCP is wider than tool calls.

It also includes:

- lifecycle
- capabilities
- transport
- resources
- prompts
- sampling
- authorization
- user consent patterns

### Mistake 2: Giving Every Tool Full Trust

Not all tools have the same risk.

Reading route status is different from changing provider auth.

Use capability tiers. Ask for approval. Log changes. Keep sensitive tools
separate.

### Mistake 3: Returning Text When A Structured Result Is Better

Text is easy for humans.

Structured data is better for machines.

A serious MCP server should return stable objects when clients need to reason
about results.

### Mistake 4: Forgetting That Servers Are Isolated

One MCP server should not assume it can see the whole chat or other servers.

The host controls context.

### Mistake 5: Treating Draft Features As Permanent

MCP is moving. Track protocol versions. Read the spec. Be careful with draft
features.

## How To Design A Good MCP Server

Use this checklist.

### Define The Job

What is this server for?

A focused server is easier to trust.

Switchmaxxer's job is local AI routing operations. So its MCP tools focus on
config, gateway state, observability, benchmarks, and optimization.

### Choose The Right Features

Do you need tools?

Do you need resources?

Do you need prompts?

Do you need sampling?

Do not add features just because they exist.

### Make The Trust Model Clear

Answer these questions:

- Is this local or remote?
- Is it stdio or HTTP?
- Who can connect?
- How are secrets loaded?
- Which actions need approval?
- Which tools mutate state?

### Use Stable Schemas

Every tool should have a clear input schema.

Reject unknown fields unless there is a strong reason not to.

### Return Stable Results

Use predictable envelopes.

Include stable error codes.

Avoid raw stack traces and secrets.

### Test Boundaries

Test the things that could hurt users:

- secrets
- file paths
- auth
- config writes
- external calls
- long-running sessions

## How To Design A Good MCP Host

A host has a different job from a server.

A good host should:

- show users what servers are connected
- show what tools are available
- ask before risky calls
- keep servers isolated
- avoid sending full chat history by default
- validate tool inputs when possible
- show tool results clearly
- keep audit trails for important actions

The host is the user's guardian. The server is the specialist.

## MCP And The Future Of AI Apps

MCP matters because AI apps are becoming less like single chat boxes and more
like coordinated workspaces.

A modern AI assistant may need to:

- read docs
- inspect logs
- query systems
- run tests
- change config
- compare results
- ask the user for approval
- explain what happened

MCP gives these abilities a shared protocol.

That does not remove the need for good design. In fact, it raises the bar.

The best MCP systems will be:

- boring in their reliability
- strict in their safety
- clear in their errors
- respectful of user control
- easy to test
- narrow where they should be narrow
- powerful where they should be powerful

## Key Terms

### MCP

Model Context Protocol. A standard way for AI apps to connect to external
context and abilities.

### Host

The AI app that the user works with.

### Client

The managed connection from a host to one MCP server.

### Server

The program or service that exposes tools, resources, prompts, or other MCP
features.

### Tool

An action the server can perform.

### Resource

Data the server can expose to the client.

### Prompt

A reusable prompt template.

### Sampling

A client-controlled way for a server to request model generation.

### Capability

A feature that a client or server says it supports.

### Transport

The path messages use to move between client and server, such as stdio or HTTP.

### JSON-RPC

The JSON message format MCP uses for requests, responses, and notifications.

### Stdio

Standard input and standard output. A common transport for local MCP servers.

### Authorization

Rules for who can access which actions or data.

### Consent

The user's approval for a specific action.

### Structured Result

A result with a stable machine-readable shape, not just free-form text.

## Final Lesson

MCP is not only a way to call tools.

MCP is a way to organize trust, context, and action between AI apps and the
systems around them.

Switchmaxxer shows one practical version of that idea. It exposes a local,
bounded, operator-focused MCP server. It does not try to implement every MCP
feature. It implements the features that match its job, and it uses clear
contracts so clients can reason about the results.

That is the deeper lesson:

```text
Good MCP design is not maximum access. Good MCP design is the right access,
through clear contracts, with user trust at the center.
```

## Further Reading

- [MCP Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)
- [MCP Overview](https://modelcontextprotocol.io/specification/2025-06-18/basic/index)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP Resources](https://modelcontextprotocol.io/specification/draft/server/resources)
- [MCP Sampling](https://modelcontextprotocol.io/docs/concepts/sampling)
- [Switchmaxxer MCP Tech Spec](../subsystems/mcp/tech-spec-for-mcp.md)
- [How To Launch Switchmaxxer MCP](../subsystems/mcp/how-to-launch-switchmaxxer-mcp.md)
