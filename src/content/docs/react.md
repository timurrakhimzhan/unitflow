---
title: React Binding
description: How View.make renders a model's ui while the model stays in Effect.
---

React is the binding layer. Models own behavior.

A View is a pure projection of a unit: `View.make(Model, render)` binds the
unit's `ui` — stores become current values, events become functions, child
units pass through to child Views. Views never resolve models: the root unit
comes from `Unitflow`, every other unit from its parent model's `ui`.

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

Every View takes exactly one wiring prop: `unit`. When a parent model returns
child units in `ui`, the parent View passes each unit to the child View.

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

## View Rules

- Read only the `ui` object passed to the render function.
- Keep durable state and business derivations in model stores.
- Publish a domain-named store, such as `counterState` or `searchState`, when
  JSX needs a computed shape.
- Use local React state only for local presentation concerns.
- Send domain actions back through model events.

Canvas, editors, and other imperative leaves may own refs and DOM lifecycle,
but durable UI state should still live in the model.
