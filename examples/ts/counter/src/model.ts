import * as Effect from "effect/Effect";
import { Event, Model, Store } from "@unitflow/react";

export class CounterModel extends Model.Service<CounterModel>()(
  "@unitflow/example/counter",
)({
  make: () =>
    Effect.gen(function* () {
      const count = Store.make(0, { name: "count" });
      const step = Store.make(1, { name: "step" });

      const increment = yield* Event.make<void>({ name: "increment" }).pipe(
        Event.handler(() =>
          Effect.gen(function* () {
            const amount = yield* Store.get(step);
            yield* Store.update(count, (value) => value + amount);
          }),
        ),
      );

      const decrement = yield* Event.make<void>({ name: "decrement" }).pipe(
        Event.handler(() =>
          Effect.gen(function* () {
            const amount = yield* Store.get(step);
            yield* Store.update(count, (value) => value - amount);
          }),
        ),
      );

      const reset = yield* Event.make<void>({ name: "reset" }).pipe(
        Event.handler(() => Store.reset(count, step)),
      );

      const view = Store.combine([count, step], (count, step) => ({
        count,
        step,
        doubled: count * 2,
        parity: count % 2 === 0 ? "even" : "odd",
      }));

      return {
        inputs: {},
        outputs: { count },
        ui: {
          view,
          setStep: Event.setter(step, { name: "setStep" }),
          increment,
          decrement,
          reset,
        },
      };
    }),
}) {}
