import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { Event, Model, Registry, Store } from "../src/index.js";

// Regression for 0.8.0, where `Model.get` widened `ui` to
// `Record<string, unknown>`: a test resolving a parent and taking a child
// unit off `page.ui` got `unknown`, and a parent re-exposing a child's ui
// port in its own `ui` no longer satisfied `make`'s shape constraint — which
// collapsed the parent's inferred shape to the base `Shape` and rejected it
// from `View.make`. Every read below is type-checked by the test gate
// (`tsc -p tsconfig.test.json`), not just executed.

class ChildModel extends Model.Service<ChildModel>()("/test/get-ui/ChildModel")({
  make: () =>
    Effect.gen(function* () {
      const countStore = Store.make(0);
      const incrementEvent = Event.input<number>();

      yield* Registry.run(
        Event.stream(incrementEvent).pipe(
          Stream.tap((amount) => Store.update(countStore, (count) => count + amount)),
        ),
      );

      return {
        inputs: { incrementEvent },
        outputs: { countStore },
        ui: { countStore, incrementEvent },
      };
    }),
}) {}

class ParentModel extends Model.Service<ParentModel>()("/test/get-ui/ParentModel")({
  make: () =>
    Effect.gen(function* () {
      const child = yield* Model.get(ChildModel);
      const label = Store.make("parent");

      return {
        inputs: {},
        outputs: { label },
        // The whole child unit, plus one of its ui ports re-exposed directly.
        ui: { child, childCount: child.ui.countStore, bump: child.ui.incrementEvent },
      };
    }),
}) {}

// A parent whose make re-exposes a child ui port must still infer its own
// precise shape — `ui` present, not the optional base `Shape["ui"]`.
type ParentUi = Model.PortsOf<typeof ParentModel>["ui"];
const _viewable: Model.Viewable = ParentModel;
const _childCount: (ui: ParentUi) => Store.Output<number> = (ui) => ui.childCount;
void _viewable;
void _childCount;

const testLayer = ParentModel.layer.pipe(
  Layer.provideMerge(ChildModel.layer),
  Layer.provideMerge(Registry.layer),
);

describe("Model.get keeps ui precisely typed", () => {
  it.effect("a test resolves the parent and hands a child unit taken from ui onwards", () =>
    Effect.gen(function* () {
      const page = yield* Model.get(ParentModel);
      const child = page.ui.child;

      yield* Registry.allSettled(Event.emit(child.ui.incrementEvent, 2));
      yield* Registry.allSettled(Event.emit(page.ui.bump, 3));

      assert.strictEqual(yield* Store.get(child.ui.countStore), 5);
      assert.strictEqual(yield* Store.get(child.outputs.countStore), 5);
      assert.strictEqual(yield* Store.get(page.ui.childCount), 5);
    }).pipe(Effect.provide(testLayer)),
  );
});
