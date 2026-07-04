import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { Event, Model, Registry, Resource, Store } from "../src/index.js";

interface UserApiShape {
  readonly getUser: (query: string) => Effect.Effect<string, string>;
}

class UserApi extends Context.Service<UserApi, UserApiShape>()("/test/resource/UserApi") {}

class UserResourceModel extends Model.Service<UserResourceModel>()(
  "/test/resource/UserResourceModel",
)({
  make: () =>
    Effect.gen(function* () {
      const query = Store.make("a");
      const user = yield* Resource.make({
        name: "user",
        stores: { query },
        handler: ({ query }) =>
          Effect.gen(function* () {
            const api = yield* UserApi;
            return yield* api.getUser(query);
          }),
      });
      const setQuery = Event.setter(query);
      const reload = user.reload;

      return {
        inputs: { setQuery, reload },
        outputs: { query, user },
        ui: { user, setQuery, reload },
      };
    }),
}) {}

const layer = (api: UserApiShape) =>
  UserResourceModel.layer.pipe(
    Layer.provideMerge(Layer.succeed(UserApi, api)),
    Layer.provideMerge(Registry.layer),
  );

describe("Resource", () => {
  it.effect("starts on model construction and settles into success", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const api = UserApi.of({
        getUser: (query) => Effect.as(Deferred.await(gate), `user:${query}`),
      });

      yield* Effect.gen(function* () {
        const model = yield* Model.get(UserResourceModel);
        assert.deepStrictEqual(yield* Store.get(model.outputs.user), { _tag: "Waiting" });

        yield* Deferred.succeed(gate, undefined);
        yield* Registry.allSettled();

        assert.deepStrictEqual(yield* Store.get(model.outputs.user), {
          _tag: "Success",
          value: "user:a",
        });
      }).pipe(Effect.provide(layer(api)));
    }));

  it.effect("reloads when dependency stores change", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const api = UserApi.of({
        getUser: (query) =>
          Effect.sync(() => {
            calls.push(query);
            return `user:${query}`;
          }),
      });

      yield* Effect.gen(function* () {
        const model = yield* Model.get(UserResourceModel);
        yield* Registry.allSettled();

        yield* Registry.allSettled(Event.emit(model.inputs.setQuery, "b"));

        assert.deepStrictEqual(calls, ["a", "b"]);
        assert.deepStrictEqual(yield* Store.get(model.outputs.user), {
          _tag: "Success",
          value: "user:b",
        });
      }).pipe(Effect.provide(layer(api)));
    }));

  it.effect("debounces dependency-triggered reloads", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];

      class DebouncedResourceModel extends Model.Service<DebouncedResourceModel>()(
        "/test/resource/DebouncedResourceModel",
      )({
        make: () =>
          Effect.gen(function* () {
            const query = Store.make("a");
            const user = yield* Resource.debounce(
              Resource.make({
                name: "debouncedUser",
                stores: { query },
                handler: ({ query }) =>
                  Effect.sync(() => {
                    calls.push(query);
                    return `user:${query}`;
                  }),
              }),
              "1 second",
            );
            const setQuery = Event.setter(query);

            return {
              inputs: { setQuery, reload: user.reload },
              outputs: { user },
              ui: { user },
            };
          }),
      }) {}

      yield* Effect.gen(function* () {
        const model = yield* Model.get(DebouncedResourceModel);
        yield* Registry.allSettled();
        assert.deepStrictEqual(calls, ["a"]);

        yield* Event.emit(model.inputs.setQuery, "b");
        yield* Event.emit(model.inputs.setQuery, "c");
        assert.deepStrictEqual(calls, ["a"]);

        yield* TestClock.adjust("999 millis");
        assert.deepStrictEqual(calls, ["a"]);

        yield* TestClock.adjust("1 millis");
        yield* Registry.allSettled();
        assert.deepStrictEqual(calls, ["a", "c"]);
      }).pipe(
        Effect.provide(DebouncedResourceModel.layer.pipe(Layer.provideMerge(Registry.layer))),
      );
    }));

  it.effect("reloads when a derived dependency changes", () =>
    Effect.gen(function* () {
      const calls: Array<number> = [];

      class DerivedResourceModel extends Model.Service<DerivedResourceModel>()(
        "/test/resource/DerivedResourceModel",
      )({
        make: () =>
          Effect.gen(function* () {
            const count = Store.make(0);
            const even = Store.combine([count], (value) => (value % 2 === 0 ? value : undefined));
            const doubled = yield* Resource.make({
              stores: { even },
              handler: ({ even }) =>
                even === undefined
                  ? Effect.fail("not open" as const)
                  : Effect.sync(() => {
                      calls.push(even);
                      return even * 2;
                    }),
            });
            const setCount = Event.setter(count);

            return {
              inputs: { setCount },
              outputs: { doubled, even },
              ui: { doubled },
            };
          }),
      }) {}

      yield* Effect.gen(function* () {
        const model = yield* Model.get(DerivedResourceModel);
        yield* Registry.allSettled();
        assert.deepStrictEqual(calls, [0]);

        yield* Registry.allSettled(Event.emit(model.inputs.setCount, 1));
        assert.deepStrictEqual(calls, [0]);
        assert.strictEqual((yield* Store.get(model.outputs.doubled))._tag, "Failure");

        yield* Registry.allSettled(Event.emit(model.inputs.setCount, 2));
        assert.deepStrictEqual(calls, [0, 2]);
        assert.deepStrictEqual(yield* Store.get(model.outputs.doubled), {
          _tag: "Success",
          value: 4,
        });
      }).pipe(Effect.provide(DerivedResourceModel.layer.pipe(Layer.provideMerge(Registry.layer))));
    }));

  it.effect("stores failures as AsyncResult data", () =>
    Effect.gen(function* () {
      const api = UserApi.of({
        getUser: () => Effect.fail("boom"),
      });

      yield* Effect.gen(function* () {
        const model = yield* Model.get(UserResourceModel);
        yield* Registry.allSettled();

        const result = yield* Store.get(model.outputs.user);
        assert.strictEqual(result._tag, "Failure");
      }).pipe(Effect.provide(layer(api)));
    }));
});
