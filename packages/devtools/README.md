# @unitflow/devtools

Runtime devtools for agents. An MCP server exposes your running unitflow app
— live model instances, store values, and a causal event log ("this emit ran
this handler which wrote this store") — to Claude Code or any MCP client.

Everything is automatic: ports are named from the model contract
(`task-model(42).inputs.rename`), no manual `{ name }` needed.

## Setup

**1. Install** (dev dependency of your app):

```sh
pnpm add -D @unitflow/devtools
```

**2. One line in your app entry:**

```ts
import { devtools } from "@unitflow/devtools";

if (import.meta.env.DEV) devtools(runtime);
```

Production builds tree-shake this away; a running app without the MCP server
just retries quietly in the background.

**3. Register the MCP server** with Claude Code (once per project):

```sh
claude mcp add unitflow -- npx -y --package=@unitflow/devtools unitflow-mcp
```

or in `.mcp.json`:

```json
{
  "mcpServers": {
    "unitflow": {
      "command": "npx",
      "args": ["-y", "--package=@unitflow/devtools", "unitflow-mcp"]
    }
  }
}
```

That's it. Start your dev server, open the app, and ask the agent.

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

## Options

```ts
devtools(runtime, {
  app: "my-app",          // how the app introduces itself
  url: "ws://localhost:4477",
  capacity: 2000,          // inspector ring buffer
});
```

The hub port is `4477` by default; override with `UNITFLOW_MCP_PORT` on the
server and `url` on the app side.

## How it works

`Debug.attach()` (from `@unitflow/core`) installs an inspector on the
registry — when detached, the hot paths pay a single property check. The
bridge streams its ring buffer to the `unitflow-mcp` process over a local
WebSocket; the MCP side is built on `effect/unstable/ai/McpServer`. Causality
comes from the synchronous dispatch windows of the core, so chains are exact
for synchronous cascades; work after an async suspension records no cause.
