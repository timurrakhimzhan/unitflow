/**
 * Type-only assertions: positive shape checks (`expectTypeOf`) for the
 * capability machinery, complementing the negative `@ts-expect-error`
 * checks that live next to their runtime behavior in the other test files.
 * Nothing here runs — `tsc -p tsconfig.test.json` (part of `pnpm test`) is
 * what actually verifies these, same as everywhere else in the suite.
 */
import { describe, expectTypeOf, it } from "vitest";
import * as Effect from "effect/Effect";
import { Event, InstanceScope, Model, Registry, Store } from "../src/index.js";

describe("Event.input / Event.toInput", () => {
  it("input() returns an InputSource, not a full Event", () => {
    const submit = Event.input<string>();
    expectTypeOf(submit).toEqualTypeOf<Event.InputSource<string>>();
    expectTypeOf(submit).not.toMatchTypeOf<Event.Event<string>>();
    expectTypeOf(submit).toMatchTypeOf<Event.Output<string>>();
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
        const submit = Event.input<string>();
        const count = Store.make(0);
        return {
          inputs: { submit },
          outputs: { count },
          ui: { count },
        };
      }),
  }) {}

  it("inputs are Input-only to everyone but the owning model", () => {
    expectTypeOf<Model.PortsOf<typeof PortModel>["inputs"]["submit"]>().toEqualTypeOf<
      Event.Input<string>
    >();
  });

  it("outputs/ui are Output-only externally", () => {
    expectTypeOf<Model.PortsOf<typeof PortModel>["outputs"]["count"]>().toEqualTypeOf<
      Store.Output<number>
    >();
    expectTypeOf<Model.PortsOf<typeof PortModel>["ui"]["count"]>().toEqualTypeOf<
      Store.Output<number>
    >();
  });
});

describe("Model.Keyed<Key>", () => {
  class UserKeyedModel extends Model.Service<UserKeyedModel>()(
    "types-test/UserKeyedModel",
  )<Store.Output<string>>()({
    make: (user) =>
      Effect.gen(function* () {
        void user;
        return { inputs: {}, outputs: {}, ui: {} };
      }),
  }) {}

  class PlainSingleton extends Model.Service<PlainSingleton>()("types-test/PlainSingleton")({
    make: () => Effect.gen(function* () {
      return { inputs: {}, outputs: {}, ui: {} };
    }),
  }) {}

  it("accepts a model keyed by exactly Key, rejects a singleton or a mismatched key", () => {
    expectTypeOf(UserKeyedModel).toMatchTypeOf<Model.Keyed<Store.Output<string>>>();
    expectTypeOf(PlainSingleton).not.toMatchTypeOf<Model.Keyed<Store.Output<string>>>();
    expectTypeOf(UserKeyedModel).not.toMatchTypeOf<Model.Keyed<Store.Output<number>>>();
  });
});

describe("Store.forwardTo / Event.forwardTo result type", () => {
  it("resolves a plain source to Effect<Source, never, InstanceScope>", () => {
    const sink = Store.make(0);
    const source = Store.make(0);
    expectTypeOf(source.pipe(Store.forwardTo(sink))).toEqualTypeOf<
      Effect.Effect<Store.Store<number>, never, InstanceScope>
    >();
  });

  it("resolves an Effect-producing source, widening R with the source's own requirements", () => {
    const sink = Event.make<number>();
    const count = Store.make(0);
    // Store.changed: Effect<Event<A>, never, Registry | InstanceScope> —
    // forwardTo must preserve that error/requirement shape, not erase it.
    expectTypeOf(count.pipe(Store.changed, Event.forwardTo(sink))).toEqualTypeOf<
      Effect.Effect<Event.Event<number>, never, Registry | InstanceScope>
    >();
  });
});
