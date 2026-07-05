---
title: Counter
description: A minimal Unitflow example with stores, events, derived state, and a React View.
---

This is the smallest useful Unitflow shape: one model owns state and events,
and one React View renders the model's `ui`.

Runnable app: `examples/ts/counter`.

## Model

```ts
import * as Effect from "effect/Effect";
import { Event, Model, Store } from "@unitflow/react";

export class CounterModel extends Model.Service<CounterModel>()(
  "@unitflow/example/counter",
)({
  make: () =>
    Effect.gen(function* () {
      const count = Store.make(0);
      const step = Store.make(1);

      const increment = yield* Event.make<void>().pipe(
        Event.handler(() =>
          Effect.gen(function* () {
            const amount = yield* Store.get(step);
            yield* Store.update(count, (value) => value + amount);
          }),
        ),
      );

      const decrement = yield* Event.make<void>().pipe(
        Event.handler(() =>
          Effect.gen(function* () {
            const amount = yield* Store.get(step);
            yield* Store.update(count, (value) => value - amount);
          }),
        ),
      );

      const reset = yield* Event.make<void>().pipe(
        Event.handler(() => Store.reset(count, step)),
      );

      const counterState = Store.combine([count, step], (count, step) => ({
        count,
        step,
        doubled: count * 2,
        parity: count % 2 === 0 ? "even" : "odd",
      }));

      return {
        inputs: {},
        outputs: { count },
        ui: {
          counterState,
          setStep: Event.setter(step),
          increment,
          decrement,
          reset,
        },
      };
    }),
}) {}
```

## View

```tsx
import { View } from "@unitflow/react";
import { CounterModel } from "./model";

export const CounterApp = View.make(CounterModel, (unit) => {
  const { count, doubled, parity, step } = unit.counterState;

  return (
    <main>
      <strong>{count}</strong>
      <span>
        {parity} / doubled {doubled}
      </span>

      <button type="button" onClick={() => unit.decrement()}>
        -{step}
      </button>
      <button type="button" onClick={() => unit.reset()}>
        Reset
      </button>
      <button type="button" onClick={() => unit.increment()}>
        +{step}
      </button>

      <input
        min={1}
        max={12}
        type="range"
        value={step}
        onChange={(event) => unit.setStep(Number(event.currentTarget.value))}
      />
    </main>
  );
});
```

## Runtime

```tsx
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { CounterApp } from "./App";
import { CounterModel } from "./model";

const runtime = UnitflowRuntime.make(CounterModel.layer);

<Unitflow runtime={runtime} rootModel={CounterModel}>
  {(app) => <CounterApp unit={app} />}
</Unitflow>;
```
