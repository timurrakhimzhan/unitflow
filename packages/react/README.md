# @unitflow/react

React binding for Unitflow.

`@unitflow/react` re-exports `@unitflow/core` and adds the React pieces:
`Unitflow`, `View.make`, `useStore`, and `useEvent`. Stores and events stay in
models; React binds only the model's public `ui` surface.

Unitflow is inspired by [Effector](https://github.com/effector/effector):
explicit stores, events, and UI logic outside the component tree, rebuilt
around Effect services, layers, scopes, and dependency injection.

## Install

```sh
pnpm add @unitflow/react @unitflow/core effect@4.0.0-beta.88 react
```

## Imports

```ts
import { Event, Model, Store, Unitflow, UnitflowRuntime, View } from "@unitflow/react";
```

## Stores and Events in a Model

Stores and events stay outside React components. A model owns them as part of
one UI unit.

```ts
import * as Effect from "effect/Effect";
import { Event, Model, Store } from "@unitflow/react";

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

## View

`View.make(Model, render)` binds the model's `ui` for React:

```txt
Store in ui -> current value
Event in ui -> callback
Child unit  -> value passed to a child View
```

```tsx
import { View } from "@unitflow/react";
import { CounterModel } from "./model";

export const CounterView = View.make(CounterModel, ({ count, increment }) => (
  <button type="button" onClick={() => increment()}>
    Count: {count}
  </button>
));
```

The render callback does not call hooks. `inputs` and `outputs` stay outside
JSX; React only receives the model's public `ui` surface.

## Runtime

`UnitflowRuntime.make(...)` receives the model layer graph. `Unitflow` leases
the root model and provides the runtime to child views.

```tsx
import * as React from "react";
import { createRoot } from "react-dom/client";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { CounterView } from "./CounterView";
import { CounterModel } from "./model";

const runtime = UnitflowRuntime.make(CounterModel.layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={CounterModel}>
      {(counter) => <CounterView unit={counter} />}
    </Unitflow>
  </React.StrictMode>,
);
```

## Hooks

Most React code should use `View.make`. Lower-level hooks are available when
you are writing a custom binding:

```tsx
const value = useStore(store);
const submit = useEvent(event);
```

Both hooks require a `<Unitflow>` root above them.
