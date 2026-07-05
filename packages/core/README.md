# @unitflow/core

Core Unitflow runtime primitives for Effect-native frontend architecture.

`@unitflow/core` starts with small frontend primitives: stores hold renderable
state, events represent actions, queries own async reads, and mutations own
async writes. Models give those primitives an Effect service boundary with
dependencies, lifetime, and typed ports.

Unitflow is inspired by [Effector](https://effector.dev/): explicit stores,
events, and UI logic outside the component tree, rebuilt around Effect services,
layers, scopes, and dependency injection.

## Install

```sh
pnpm add @unitflow/core effect@4.0.0-beta.88
```

## Imports

```ts
import { Event, Model, Mutation, Query, Registry, Store } from "@unitflow/core";
```

## The Shape

```txt
Store     -> renderable state
Event     -> typed action
Query     -> async read with visible state
Mutation  -> async write with visible state and done event
Model     -> UI-facing Effect service and ownership boundary
Registry  -> scoped runtime storage, model instances, and settling
```

## Stores

```ts
const count = Store.make(0);

yield* Store.set(count, 1);
yield* Store.update(count, (value) => value + 1);

const doubled = count.pipe(Store.map((value) => value * 2));
```

Stores can be read with `Store.get(...)`, derived with `Store.map(...)` or
`Store.combine(...)`, and streamed with `Store.stream(...)`.

## Events

```ts
const submitted = yield* Event.make<string>().pipe(
  Event.handler((name) => Effect.log(`submitted ${name}`)),
);

yield* Event.emit(submitted, "Ada");
```

Events are point-in-time model actions. Use `Event.handler(...)` for ordinary
model behavior and `Event.stream(...)` when you need stream operators.

## Queries

```ts
const projects = yield* Query.make(fetchProjects);

return {
  inputs: { refresh: projects.refresh },
  outputs: { projects: projects.state },
  ui: { projects: projects.state, refresh: projects.refresh },
};
```

Queries are model-owned async reads. They expose `state` and `refresh`; the
handler is a normal Effect.

## Mutations

```ts
const save = yield* Mutation.make(saveProject);

return {
  inputs: { save: save.run },
  outputs: { saved: save.done },
  ui: { save: save.run, saveState: save.state },
};
```

Mutations are model-owned async writes. They expose `run`, `state`, and `done`.

## Models

A model is an Effect service for one UI unit: a screen, form, row, dialog,
panel, or headless behavior service. It owns state, actions, async work,
dependencies, child models, and lifetime.

Models expose typed sections:

```ts
return {
  inputs: {},  // actions other code may trigger
  outputs: {}, // state/events other code may observe
  ui: {},      // render surface for a View
};
```

Because models are services, they compose with `Layer`, can depend on regular
Effect services, and can be replaced in tests.

## Minimal Model

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

## Testing

Use the same public actions the UI uses, then wait for async and reactive work
to settle.

```ts
yield* Registry.allSettled(
  Event.emit(counter.inputs.increment),
);

const value = yield* Store.get(counter.outputs.count);
```
