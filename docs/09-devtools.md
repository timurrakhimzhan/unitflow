# Agent Devtools (MCP)

`@unitflow/devtools` exposes the running app to a coding agent over MCP: live
model instances, store values (derived stores evaluated on demand), and a
causal event log — every write and emit with a link to the publication whose
synchronous dispatch produced it. Ports are named automatically from the
model contract (`task-model(42).inputs.rename`); setter targets and combined
sources get cascaded names.

Setup:

```ts
import { devtools } from "@unitflow/devtools";

if (import.meta.env.DEV) devtools(runtime);
```

```sh
claude mcp add unitflow -- npx -y --package=@unitflow/devtools unitflow-mcp
```

Tools: `list_instances`, `get_stores(filter)`, `event_log(since_seq, filter,
limit)`, `trace(seq)`.

Detached (always, in production) the hot paths pay one property check;
`devtools()` is tree-shaken out of production builds behind the dev guard.
Causality is exact for synchronous cascades; work after an asynchronous
suspension records no cause. The bridge dials `ws://localhost:4477`
(`UNITFLOW_MCP_PORT` / the `url` option to override).
