# Unitflow

Effect-native frontend architecture with self-contained models, typed
boundaries, scoped state, actions, async work, lifetime, and React bindings.

Unitflow brings Effect's application shape to UI code. Start with small
frontend primitives: stores for renderable state, events for actions, and
queries or mutations for visible async work. Models give those primitives an
Effect service boundary with dependencies, lifetime, typed ports, child models,
and renderer-independent views.

Unitflow is inspired by [Effector](https://github.com/effector/effector):
explicit stores, events, and UI logic outside the component tree, rebuilt
around Effect services, layers, scopes, and dependency injection.

## Install

For React apps:

```sh
pnpm add @unitflow/react @unitflow/core effect@4.0.0-beta.88 react
```

For non-React runtimes:

```sh
pnpm add @unitflow/core effect@4.0.0-beta.88
```

## Core Ideas

```txt
Store     -> renderable state
Event     -> typed action
Query     -> async read with visible loading/failure/success state
Mutation  -> async write with visible progress, failure, result, and done event
Model     -> UI-facing Effect service and ownership boundary
View      -> renderer binding for a model's public ui surface
```

Stores and events are intentionally small. Queries and mutations cover visible
async work. Models give those primitives a place to live, a dependency graph,
typed boundaries, and lifetime.

## Stores and Events

Use `Store.make(initial)` for state that belongs to the model. Read with
`Store.get`, write with `Store.set` / `Store.update`, derive with
`Store.map` / `Store.combine`, and stream changes with `Store.stream`.

Use `Event.make<A>()` for actions. Emit them with `Event.emit`, handle them
with `Event.handler`, merge them with `Event.combine`, or turn them into
streams with `Event.stream`.

## Queries and Mutations

Use `Query.make(...)` for async reads that need visible state. Query handlers
are normal Effects, so they can use dependency injection, retry, timeout,
schedules, schemas, and typed errors.

Use `Mutation.make(...)` for async writes that need visible progress, failure,
latest success, or a success event. Mutations expose `run`, `state`, and
`done`.

## Models

A model owns one coherent piece of UI behavior: a screen, panel, row, form,
dialog, or headless service. It returns a public shape:

```ts
return {
  inputs: {},  // actions outside code may trigger
  outputs: {}, // state/events outside code may observe
  ui: {},      // render surface for a View
};
```

Inside `make`, model code is ordinary Effect code. It can `yield*` services,
use `Layer`, `Scope`, `Stream`, typed errors, schedules, schemas, and test
replacement. A model can also resolve child models with `Model.get(...)` or own
dynamic child collections with `Model.list(...)`.

## Small Example

```ts
import * as Effect from "effect/Effect";
import { Event, Model, Store } from "@unitflow/core";

export class CounterModel extends Model.Service<CounterModel>()(
  "readme/counter",
)({
  make: Effect.gen(function* () {
    const count = Store.make(0);

    const increment = yield* Event.make<void>().pipe(
      Event.handler(() => Store.update(count, (value) => value + 1)),
    );

    return {
      inputs: { increment },
      outputs: { count },
      ui: { count, increment },
    };
  }),
}) {}
```

```tsx
import * as React from "react";
import { createRoot } from "react-dom/client";
import { Unitflow, UnitflowRuntime, View } from "@unitflow/react";
import { CounterModel } from "./model";

const CounterView = View.make(CounterModel, ({ count, increment }) => (
  <button type="button" onClick={() => increment()}>
    Count: {count}
  </button>
));

const runtime = UnitflowRuntime.make(CounterModel.layer);

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={CounterModel}>
      {(counter) => <CounterView unit={counter} />}
    </Unitflow>
  </React.StrictMode>,
);
```

## Agent Devtools (MCP)

Your running app, visible to a coding agent: live model instances, store
values, and a causal event log — "this emit ran this handler which wrote this
store". Ports are named automatically from the model contract.

```ts
import { devtools } from "@unitflow/devtools";

if (import.meta.env.DEV) devtools(runtime);
```

```sh
claude mcp add unitflow -- npx -y --package=@unitflow/devtools unitflow-mcp
```

See [`packages/devtools`](packages/devtools/README.md) for the tool list and
options.

## Packages

```txt
@unitflow/core      Model, Store, Event, Registry, Query, Mutation, runtime
@unitflow/react     React binding, Unitflow root, View.make, hooks, core re-exports
@unitflow/devtools  Runtime inspector bridge and MCP server for agents
```

## Development

```sh
pnpm dev
pnpm packages:build
pnpm packages:test
pnpm docs:check
pnpm check
```

`pnpm dev` serves the Starlight docs site at `http://localhost:4177`.
