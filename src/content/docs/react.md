---
title: React Binding
description: How View.make renders a model's ui while the model stays in Effect.
---

React is the binding layer. Models own behavior.

A View is a pure projection of a unit: `View.make(Model, render)` binds the
unit's `ui` — stores become current values, events become functions, child
units pass through to child Views. Normally a View never resolves a model
itself: the root unit comes from `Unitflow`, every other unit from its
parent model's `ui`. A [keyed model](/model/#keys) is the one exception — a
View can lease one directly, by key, with no parent needed; see
[Lease a Model Directly](#lease-a-model-directly).

## Bootstrap with Unitflow

`Unitflow` is the single meeting point of React and the runtime: it provides
the runtime to every hook below and leases the root model, handing its unit
to the render prop.

```tsx
import * as React from "react";
import { createRoot } from "react-dom/client";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { CounterApp } from "./App";
import { CounterModel } from "./model";

const runtime = UnitflowRuntime.make(CounterModel.layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={CounterModel} building={<Splash />}>
      {(app) => <CounterApp unit={app} />}
    </Unitflow>
  </React.StrictMode>,
);
```

Pass the model layer graph into `UnitflowRuntime.make(...)`. The runtime
provides a fresh `Registry.layer` for this app instance. `building` renders
while the root graph constructs; `failed` receives the construction cause.
Two independent roots on one page are two `Unitflow` elements sharing one
runtime.

## Create a View

```tsx
import { View } from "@unitflow/react";
import { CounterModel } from "./model";

export const CounterApp = View.make(CounterModel, (unit) => {
  const { count, doubled, step } = unit.counterState;

  return (
    <main>
      <strong>{count}</strong>
      <span>Doubled: {doubled}</span>

      <button type="button" onClick={() => unit.decrement()}>
        -{step}
      </button>
      <button type="button" onClick={() => unit.increment()}>
        +{step}
      </button>

      <input
        type="range"
        value={step}
        onChange={(event) => unit.setStep(Number(event.currentTarget.value))}
      />
    </main>
  );
});
```

The render function does not call Unitflow hooks. `View.make` has already bound
the model's `ui`:

```txt
Store in ui -> current value
Event in ui -> function
Child unit  -> value passed to a child View
```

## Render a Child Unit

A View bound this way takes exactly one wiring prop: `unit`. When a parent
model returns child units in `ui`, the parent View passes each unit to the
child View.

```tsx
export const BoardView = View.make(BoardModel, ({ boardState, taskUnits }) => (
  <section>
    {taskUnits.map((task) => (
      <TaskView key={task.key.id} unit={task} />
    ))}
  </section>
));
```

The parent View does not import the child's internals. It renders the child
unit the parent model already owns — and that ownership is the whole
lifecycle story: JSX cannot summon an instance, so every keyed instance
traces back to a model decision (`Model.get`, `Model.list` push/remove). A
flow like "opening a popover materializes its child" is a model event, which
also makes it testable headlessly with `Registry.allSettled` — no browser
needed.

## Lease a Model Directly

Pass a third argument to bind a [keyed model](/model/#keys) that leases
itself, by key, instead of receiving an already-resolved `unit` — no parent
needs to have resolved it first. `Model.get` inside a model's own `make()`
still blocks until the whole subtree is ready; this is the one place a View
gets its own independent `Building`/`Ready`/`Failed` instead of inheriting
the root's.

```tsx
interface ProjectKey {
  readonly id: string;
}

export class ProjectModel extends Model.Service<ProjectModel>()(
  "docs/project",
)<ProjectKey>()({
  make: ({ id }) =>
    Effect.gen(function* () {
      const name = Store.make(fetchProjectName(id));
      return { inputs: {}, outputs: {}, ui: { name } };
    }),
}) {}

export const ProjectView = View.make(
  ProjectModel,
  ({ name }) => <h1>{name}</h1>,
  {
    building: <p>Loading…</p>,
    failed: () => <p>Something went wrong.</p>,
  },
);

// mounts anywhere — no parent needs to have resolved ProjectModel first
export const Page = () => <ProjectView modelKey={{ id: "p1" }} />;
```

The third argument (`{ building?, failed? }`, `{}` included) is what
selects this form — it is what tells `View.make` "lease this model
yourself" instead of "expect an already-resolved `unit` prop". Both default
to rendering nothing, same as `Unitflow`'s own `building`/`failed`. The
prop is `modelKey`, not `key` — `key` is React's own reserved prop for
reconciliation, so it can never be read back out on the receiving end.

The router (see [Route-Fed Page Views](/router/react/#route-fed-page-views))
recognizes this exact overload directly — no separate wrapper needed — and
supplies the matched route's own `Route.Output` as `modelKey`
automatically.

## View Rules

- Read only the `ui` object passed to the render function.
- Keep durable state and business derivations in model stores.
- Publish a domain-named store, such as `counterState` or `searchState`, when
  JSX needs a computed shape.
- Use local React state only for local presentation concerns.
- Send domain actions back through model events.

Canvas, editors, and other imperative leaves may own refs and DOM lifecycle,
but durable UI state should still live in the model.
