import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Event, Registry, Store } from "../src/index.js";

describe("Store.forwardTo", () => {
  it.effect("writes every source emission into the sink", () =>
    Effect.gen(function* () {
      const source = Store.make(0);
      const sink = Store.make(-1);

      yield* source.pipe(Store.forwardTo(sink));

      yield* Registry.allSettled(Store.set(source, 1));
      assert.strictEqual(yield* Store.get(sink), 1);

      yield* Registry.allSettled(Store.set(source, 2));
      assert.strictEqual(yield* Store.get(sink), 2);
    }).pipe(Effect.provide(Registry.layer)),
  );

  it.effect("Registry.allSettled waits for the forwarded write, not just the source's", () =>
    Effect.gen(function* () {
      const source = Store.make(0);
      const sink = Store.make(0);
      const seenAtSink: Array<number> = [];

      yield* source.pipe(Store.forwardTo(sink));
      yield* sink.pipe(
        Store.changed,
        Event.handler((value) =>
          Effect.sync(() => {
            seenAtSink.push(value);
          }),
        ),
      );

      yield* Registry.allSettled(Store.set(source, 5));

      // If allSettled only waited for `source`'s own subscribers and not the
      // forwarded write's cascade into `sink`, this would still be empty.
      assert.deepStrictEqual(seenAtSink, [5]);
    }).pipe(Effect.provide(Registry.layer)),
  );
});

describe("Event.forwardTo", () => {
  it.effect("emits every source occurrence into the sink", () =>
    Effect.gen(function* () {
      const source = Event.make<number>();
      const sink = Event.make<number>();
      const seen: Array<number> = [];

      yield* sink.pipe(
        Event.handler((value) =>
          Effect.sync(() => {
            seen.push(value);
          }),
        ),
      );
      yield* source.pipe(Event.forwardTo(sink));

      yield* Registry.allSettled(Event.emit(source, 1), Event.emit(source, 2));

      assert.deepStrictEqual(seen, [1, 2]);
    }).pipe(Effect.provide(Registry.layer)),
  );

  it.effect("accepts an Effect-producing source, e.g. Store.changed", () =>
    Effect.gen(function* () {
      const count = Store.make(0);
      const sink = Event.make<number>();
      const seen: Array<number> = [];

      yield* sink.pipe(
        Event.handler((value) =>
          Effect.sync(() => {
            seen.push(value);
          }),
        ),
      );
      // Store.changed returns Effect<Event<A>> — forwardTo resolves it first.
      yield* count.pipe(Store.changed, Event.forwardTo(sink));

      yield* Registry.allSettled(Store.set(count, 1), Store.set(count, 2));

      assert.deepStrictEqual(seen, [1, 2]);
    }).pipe(Effect.provide(Registry.layer)),
  );
});
