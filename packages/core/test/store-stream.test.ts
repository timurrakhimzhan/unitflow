import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { InstanceScope, Model, Registry, Store } from "../src/index.js";

const testRegistry = Layer.mergeAll(Registry.layer, InstanceScope.root);

/** A pipeline forked in a model's own `make`, which is where the subscription
 * timing matters: everything the model writes during construction happens
 * before the fork has had a scheduler turn. */
const seen: Array<string> = [];
const watched = {
  project: Store.make("p1"),
  tab: Store.make(0),
};

class KeyWatcher extends Model.Service<KeyWatcher>()("test/key-watcher")({
  make: () =>
    Effect.gen(function* () {
      const key = Store.combine(
        [watched.project, watched.tab],
        (project, tab) => `${project}:${tab}`,
      );

      yield* Registry.run(
        Store.stream(key).pipe(Stream.mapEffect((value) => Effect.sync(() => seen.push(value)))),
      );

      return { inputs: {}, outputs: {}, ui: {} };
    }),
}) {}

describe("Store.stream", () => {
  it.effect("a combined store over several sources replays its current value", () =>
    Effect.gen(function* () {
      const project = Store.make("p1");
      const tab = Store.make(0);
      const key = Store.combine([project, tab], (project, tab) => `${project}:${tab}`);

      const values: Array<string> = [];
      yield* Registry.run(
        Store.stream(key).pipe(Stream.mapEffect((value) => Effect.sync(() => values.push(value)))),
      );
      // The write follows the fork with no suspension in between: the
      // subscription must already exist, exactly as for a plain store.
      yield* Registry.allSettled(Store.set(project, "p2"));

      assert.deepStrictEqual(values, ["p1:0", "p2:0"]);
    }).pipe(Effect.provide(testRegistry)),
  );

  it.effect("every source of a combined store keeps allSettled waiting", () =>
    Effect.gen(function* () {
      const project = Store.make("p1");
      const tab = Store.make(0);
      const key = Store.combine([project, tab], (project, tab) => `${project}:${tab}`);

      const values: Array<string> = [];
      yield* Registry.run(
        Store.stream(key).pipe(Stream.mapEffect((value) => Effect.sync(() => values.push(value)))),
      );

      yield* Registry.allSettled(Store.set(tab, 1));
      assert.deepStrictEqual(values, ["p1:0", "p1:1"]);

      yield* Registry.allSettled(Store.set(project, "p2"));
      assert.deepStrictEqual(values, ["p1:0", "p1:1", "p2:1"]);
    }).pipe(Effect.provide(testRegistry)),
  );

  it.effect("a recomputation equal to the last emission is not an emission", () =>
    Effect.gen(function* () {
      const project = Store.make("p1");
      const tab = Store.make(0);
      // `tab` is watched but does not reach the value: writing it recomputes
      // the same string, which must neither emit nor stall `allSettled`.
      const key = Store.combine([project, tab], (project) => project);

      const values: Array<string> = [];
      yield* Registry.run(
        Store.stream(key).pipe(Stream.mapEffect((value) => Effect.sync(() => values.push(value)))),
      );

      yield* Registry.allSettled(Store.set(tab, 1));
      yield* Registry.allSettled(Store.set(tab, 2));
      assert.deepStrictEqual(values, ["p1"]);

      yield* Registry.allSettled(Store.set(project, "p2"));
      assert.deepStrictEqual(values, ["p1", "p2"]);
    }).pipe(Effect.provide(testRegistry)),
  );

  it.effect("a pipeline forked in make receives the key it was forked to watch", () =>
    Effect.gen(function* () {
      seen.length = 0;
      yield* Model.get(KeyWatcher);
      yield* Registry.allSettled();

      assert.deepStrictEqual(seen, ["p1:0"]);

      yield* Registry.allSettled(Store.set(watched.project, "p2"));
      assert.deepStrictEqual(seen, ["p1:0", "p2:0"]);
    }).pipe(Effect.provide(KeyWatcher.layer.pipe(Layer.provideMerge(Registry.layer)))),
  );
});
