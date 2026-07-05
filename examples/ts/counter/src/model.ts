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
