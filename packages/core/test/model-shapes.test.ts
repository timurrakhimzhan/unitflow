import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Model, Registry, Store } from "../src/index.js";

type SectionKey = "counter" | "label";

interface CounterShape extends Model.Shape {
  readonly inputs: Record<never, never>;
  readonly outputs: { readonly count: Store.Store<number> };
  readonly ui: { readonly count: Store.Store<number> };
}

interface LabelShape extends Model.Shape {
  readonly inputs: Record<never, never>;
  readonly outputs: { readonly label: Store.Store<string> };
  readonly ui: { readonly label: Store.Store<string> };
}

interface SectionShapes {
  readonly counter: CounterShape;
  readonly label: LabelShape;
}

/** A keyed model whose per-key shape map narrows `Model.get` by key literal:
 * the runtime builds the union shape, the map declares which half each key
 * actually exposes. */
class SectionModel extends Model.Service<SectionModel>()(
  "/test/test/SectionModel",
)<SectionKey, SectionShapes>()({
  make: (key) =>
    Effect.sync(() => {
      if (key === "counter") {
        const count = Store.make(0);
        return { inputs: {}, outputs: { count }, ui: { count } } as CounterShape & LabelShape;
      }
      const label = Store.make("ready");
      return { inputs: {}, outputs: { label }, ui: { label } } as CounterShape & LabelShape;
    }),
}) {}

describe("Model per-key shapes", () => {
  it.effect("narrows Model.get ports by key literal", () =>
    Effect.gen(function* () {
      const counter = yield* Model.get(SectionModel, "counter");
      const label = yield* Model.get(SectionModel, "label");

      // Runtime: each key's instance exposes its own ports.
      assert.strictEqual(yield* Store.get(counter.outputs.count), 0);
      assert.strictEqual(yield* Store.get(label.outputs.label), "ready");

      // Types: the key literal picks the shape from the declared map.
      const count: Store.Output<number> = counter.outputs.count;
      const text: Store.Output<string> = label.outputs.label;
      void count;
      void text;
      if (false) {
        // @ts-expect-error "counter" ports do not expose the label store
        counter.outputs.label;
        // @ts-expect-error "label" ports do not expose the count store
        label.outputs.count;
        // @ts-expect-error keys are constrained to the declared union
        void Model.get(SectionModel, "missing");
      }
    }).pipe(Effect.provide(SectionModel.layer.pipe(Layer.provideMerge(Registry.layer)))),
  );
});
