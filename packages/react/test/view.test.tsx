import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as React from "react";
import * as Stream from "effect/Stream";
import { Event, Model, Registry, Store } from "../src/index.js";
import { View } from "../src/index.js";

class CounterModel extends Model.Service<CounterModel>()(
  "/test/view-test/CounterModel",
)({
  make: () =>
    Effect.gen(function* () {
      const countStore = Store.make(0);
      const incrementEvent = Event.make<number>();

      yield* Registry.run(
        Event.stream(incrementEvent).pipe(
          Stream.tap((amount) => Store.update(countStore, (count) => count + amount)),
        ),
      );

      return {
        inputs: {
          incrementEvent,
        },
        outputs: {
          countStore,
        },
        ui: {
          countStore,
          incrementEvent,
        },
        // An EXTRA section: observable by models, invisible to the View.
        analytics: {
          countStore,
        },
      };
    }),
}) {}

interface RenderKey {
  readonly id: string;
}

class RenderModel extends Model.Service<RenderModel>()(
  "/test/view-test/RenderModel",
)<RenderKey>()({
  make: (key) =>
    Effect.sync(() => {
      const labelStore = Store.make(`render:${key.id}`);
      return {
        inputs: {},
        outputs: {},
        ui: {
          labelStore,
        },
      };
    }),
}) {}

interface NestedKey {
  readonly project: { readonly id: string };
}

class NestedKeyModel extends Model.Service<NestedKeyModel>()(
  "/test/view-test/NestedKeyModel",
)<NestedKey>()({
  make: () =>
    Effect.sync(() => ({
      inputs: {},
      outputs: {},
      ui: {},
    })),
}) {}

describe("View.make", () => {
  it("hands the render callback bound units — values and callbacks (type-level)", () => {
    const CounterView = View.make(CounterModel, (units) => {
      // @ts-expect-error inputs/outputs are host wiring, not part of units
      void units.inputs;
      // @ts-expect-error extra sections are observation surfaces for models, not part of units
      void units.analytics;
      // stores arrive as their current values...
      const count: number = units.countStore;
      // ...and events as fire callbacks — no hooks needed
      units.incrementEvent(count + 1);
      // @ts-expect-error the callback payload is typed
      units.incrementEvent("not a number");
      // @ts-expect-error a bound value is not a store descriptor anymore
      void Store.get(units.countStore);
      return null;
    });

    assert.strictEqual(
      CounterView.displayName,
      "View(/test/view-test/CounterModel)",
    );
  });

  it("requires a key for keyed views and none for singletons (type-level)", () => {
    const CounterView = View.make(CounterModel, () => null);
    const RenderView = View.make(RenderModel, (units) => {
      const label: string = units.labelStore;
      void label;
      return null;
    });

    const NestedView = View.make(NestedKeyModel, () => null);

    const singleton = <CounterView />;
    const keyed = <RenderView unitKey={{ id: "first" }} />;
    // @ts-expect-error keyed views require their unit key
    const missingKey = <RenderView />;
    // @ts-expect-error the key must match the model's key type
    const wrongKey = <RenderView unitKey={{ id: 1 }} />;
    // @ts-expect-error a unit key must be FLAT plain data (Model.KeyInput)
    const nestedKey = <NestedView unitKey={{ project: { id: "p1" } }} />;

    assert.isDefined(singleton);
    assert.isDefined(keyed);
    assert.isDefined(missingKey);
    assert.isDefined(wrongKey);
    assert.isDefined(nestedKey);
  });
});
