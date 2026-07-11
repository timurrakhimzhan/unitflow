/**
 * Type-only assertions: positive shape checks (`expectTypeOf`) for the
 * capability machinery, complementing the negative `@ts-expect-error`
 * checks that live next to their runtime behavior in the other test files.
 * Nothing here runs — `tsc -p tsconfig.test.json` (part of `pnpm test`) is
 * what actually verifies these, same as everywhere else in the suite.
 */
import { describe, expectTypeOf, it } from "vitest";
import * as Effect from "effect/Effect";
import { Event, Model, Registry, Store } from "../src/index.js";

describe("Store.input / Store.toInput", () => {
  it("input() returns an InputSource, not a full Store", () => {
    const user = Store.input("");
    expectTypeOf(user).toEqualTypeOf<Store.InputSource<string>>();
    expectTypeOf(user).not.toMatchTypeOf<Store.Store<string>>();
    // Source capability (read) is intact.
    expectTypeOf(user).toMatchTypeOf<Store.Source<string>>();
  });

  it("toInput() narrows an existing Store to InputSource, same A", () => {
    const full = Store.make(0);
    expectTypeOf(Store.toInput(full)).toEqualTypeOf<Store.InputSource<number>>();
  });
});

describe("Event.input / Event.toInput", () => {
  it("input() returns an InputSource, not a full Event", () => {
    const submit = Event.input<string>();
    expectTypeOf(submit).toEqualTypeOf<Event.InputSource<string>>();
    expectTypeOf(submit).not.toMatchTypeOf<Event.Event<string>>();
    expectTypeOf(submit).toMatchTypeOf<Event.Source<string>>();
  });

  it("toInput() narrows an existing Event to InputSource, same A", () => {
    const full = Event.make<number>();
    expectTypeOf(Event.toInput(full)).toEqualTypeOf<Event.InputSource<number>>();
  });
});

describe("Model.PortsOf narrowing", () => {
  class PortModel extends Model.Service<PortModel>()("types-test/PortModel")({
    make: () =>
      Effect.gen(function* () {
        const user = Store.input("");
        const count = Store.make(0);
        return {
          inputs: { user },
          outputs: { count },
          ui: { count },
        };
      }),
  }) {}

  it("inputs are Sink-only to everyone but the owning model", () => {
    expectTypeOf<Model.PortsOf<typeof PortModel>["inputs"]["user"]>().toEqualTypeOf<
      Store.Sink<string>
    >();
  });

  it("outputs/ui are Source-only externally", () => {
    expectTypeOf<Model.PortsOf<typeof PortModel>["outputs"]["count"]>().toEqualTypeOf<
      Store.Source<number>
    >();
    expectTypeOf<Model.PortsOf<typeof PortModel>["ui"]["count"]>().toEqualTypeOf<
      Store.Source<number>
    >();
  });
});

describe("Store.forwardTo / Event.forwardTo result type", () => {
  it("resolves a plain source to Effect<Source, never, Registry>", () => {
    const sink = Store.make(0);
    const source = Store.make(0);
    expectTypeOf(source.pipe(Store.forwardTo(sink))).toEqualTypeOf<
      Effect.Effect<Store.Store<number>, never, Registry>
    >();
  });

  it("resolves an Effect-producing source, widening R with the source's own requirements", () => {
    const sink = Event.make<number>();
    const count = Store.make(0);
    // Store.changed: Effect<Event<A>, never, Registry> — forwardTo must
    // preserve that error/requirement shape, not erase it to `never`/`Registry`.
    expectTypeOf(count.pipe(Store.changed, Event.forwardTo(sink))).toEqualTypeOf<
      Effect.Effect<Event.Event<number>, never, Registry>
    >();
  });
});
