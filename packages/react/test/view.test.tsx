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

  it("every View requires its unit — parents or Unitflow hand it down (type-level)", () => {
    const CounterView = View.make(CounterModel, () => null);
    const RenderView = View.make(RenderModel, (units) => {
      const label: string = units.labelStore;
      void label;
      return null;
    });

    // Типовые свидетели: в рантайме не используются, JSX ниже не рендерится.
    // eslint-disable-next-line revizo/no-type-assertion
    const counterUnit = null as unknown as Model.PortsOf<typeof CounterModel>;
    // eslint-disable-next-line revizo/no-type-assertion
    const renderUnit = null as unknown as Model.PortsOf<typeof RenderModel>;

    const singleton = <CounterView unit={counterUnit} />;
    const keyed = <RenderView unit={renderUnit} />;
    // @ts-expect-error a View cannot render without its unit
    const bareSingleton = <CounterView />;
    // @ts-expect-error a View cannot render without its unit
    const bareKeyed = <RenderView />;
    // @ts-expect-error resolving by key from JSX is gone: models own instances
    const byKey = <RenderView unitKey={{ id: "first" }} />;

    assert.isDefined(singleton);
    assert.isDefined(keyed);
    assert.isDefined(bareSingleton);
    assert.isDefined(bareKeyed);
    assert.isDefined(byKey);
  });

  it("rejects headless models — View.make requires a ui section (type-level)", () => {
    class HeadlessModel extends Model.Service<HeadlessModel>()(
      "/test/view-test/HeadlessModel",
    )({
      make: () =>
        Effect.gen(function* () {
          const total = Store.make(0);
          return { inputs: {}, outputs: { total } };
        }),
    }) {}

    // @ts-expect-error a model without a ui section is not Viewable
    const HeadlessView = View.make(HeadlessModel, () => null);
    assert.isDefined(HeadlessView);
  });
});
