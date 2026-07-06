---
title: Agent Devtools (MCP)
description: Expose the running app to a coding agent — live models, store values, and causal event traces over MCP.
---

`@unitflow/devtools` makes the running app visible to a coding agent: an MCP
server exposes live model instances, store values, and a causal event log —
"this emit ran this handler which wrote this store". Everything is named
automatically from the model contract (`task-model(42).inputs.rename`), no
manual `{ name }` needed.

## Setup

Install as a dev dependency:

```sh
pnpm add -D @unitflow/devtools
```

One line in the app entry:

```ts
import { devtools } from "@unitflow/devtools";

if (import.meta.env.DEV) devtools(runtime);
```

Production builds tree-shake this away; a dev app without the MCP server
running just retries quietly in the background.

Register the MCP server with Claude Code (once per project):

```sh
claude mcp add unitflow -- npx -y --package=@unitflow/devtools unitflow-mcp
```

Start the dev server, open the app, and ask the agent what is going on.

## Tools

| Tool | Returns |
| --- | --- |
| `list_instances` | Live model instances: id, key, lease count |
| `get_stores` | Store values by name filter — derived (combined) stores included, evaluated on demand |
| `event_log` | Writes, emits, and instance lifecycle, oldest first, with causal links |
| `trace` | The full causal chain of one event: ancestors to the root, plus descendants |

A typical answer to "what happened when I typed in the search box":

```txt
#5      write  app/search.ui.setQuery.target   "relay"
#6  ←#5 write  app/search.outputs.results      { _tag: "Success", value: [...] }
```

## How It Works

`Debug.attach()` (from `@unitflow/core`) installs an inspector on the
registry. When no inspector is attached — always, in production — the hot
paths pay a single property check. Port names come from the model contract at
construction: section and record key form the address, setter targets and
combined sources inherit cascaded names.

The bridge streams the inspector's ring buffer to the `unitflow-mcp` process
over a local WebSocket (`ws://localhost:4477`, override with
`UNITFLOW_MCP_PORT` and the `url` option). The MCP side is built on
`effect/unstable/ai/McpServer`.

Causality comes from the synchronous dispatch windows of the core: chains are
exact for synchronous cascades, while work after an asynchronous suspension
records no cause.

## Options

```ts
devtools(runtime, {
  app: "my-app",              // how the app introduces itself
  url: "ws://localhost:4477", // the MCP hub address
  capacity: 2000,             // inspector ring buffer size
});
```
