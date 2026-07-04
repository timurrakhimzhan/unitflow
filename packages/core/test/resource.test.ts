import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as TestClock from "effect/testing/TestClock";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Event, Registry, Store } from "../src/index.js";
import * as Resource from "../src/resource.js";

const awaitCondition = (predicate: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    while (!predicate()) {
      yield* Effect.yieldNow;
    }
  });

const successValue = <A, E>(result: AsyncResult.AsyncResult<A, E>): A | null =>
  Option.getOrElse(
    Option.map(AsyncResult.value(result), (value): A | null => value),
    () => null,
  );

/** A request that parks each run on its own deferred, so tests control when
 * every load settles. */
const gatedRequest = <A, E = never>() => {
  const gates: Array<Deferred.Deferred<A, E>> = [];
  const request = Effect.suspend(() => {
    const gate = Deferred.makeUnsafe<A, E>();
    gates.push(gate);
    return Deferred.await(gate);
  });
  const gateAt = (index: number) => {
    const gate = gates[index];
    if (gate === undefined) throw new Error(`Missing gate ${index}`);
    return gate;
  };
  return { gates, request, gateAt };
};

describe("Resource", () => {
  it.effect("loads eagerly once at construction", () =>
    Effect.gen(function* () {
      let calls = 0;
      const resource = yield* Resource.make(
        Effect.sync(() => {
          calls += 1;
          return calls;
        }),
      );

      assert.isTrue(AsyncResult.isInitial(resource.state.initial));
      yield* Store.waitFor(resource.state, (result) => successValue(result) === 1);
      assert.strictEqual(calls, 1);
    }).pipe(Effect.provide(Registry.layer)),
  );

  it.effect("refresh keeps the previous value while waiting", () =>
    Effect.gen(function* () {
      const backend = gatedRequest<number>();
      const resource = yield* Resource.make(backend.request);

      yield* awaitCondition(() => backend.gates.length === 1);
      yield* Deferred.succeed(backend.gateAt(0), 1);
      yield* Store.waitFor(resource.state, (result) => successValue(result) === 1);

      yield* Event.emit(resource.refresh);
      yield* awaitCondition(() => backend.gates.length === 2);

      const waiting = yield* Store.get(resource.state);
      assert.isTrue(AsyncResult.isWaiting(waiting));
      assert.strictEqual(successValue(waiting), 1);

      yield* Deferred.succeed(backend.gateAt(1), 2);
      yield* Store.waitFor(
        resource.state,
        (result) => successValue(result) === 2 && !result.waiting,
      );
    }).pipe(Effect.provide(Registry.layer)),
  );

  it.effect("a dependency change reloads with the fresh dependency value", () =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      const dep = Store.make("a");
      const resource = yield* Resource.make({
        stores: { dep },
        handler: ({ dep: value }) =>
          Effect.sync(() => {
            seen.push(value);
            return value.toUpperCase();
          }),
      });

      yield* Store.waitFor(resource.state, (result) => successValue(result) === "A");
      yield* Registry.allSettled(Store.set(dep, "b"));
      assert.strictEqual(successValue(yield* Store.get(resource.state)), "B");
      assert.deepStrictEqual(seen, ["a", "b"]);
    }).pipe(Effect.provide(Registry.layer)),
  );

  it.effect("a failed reload keeps the previous success", () =>
    Effect.gen(function* () {
      let calls = 0;
      const resource = yield* Resource.make(
        Effect.suspend(() => {
          calls += 1;
          return calls === 1 ? Effect.succeed("one") : Effect.fail("boom");
        }),
      );

      yield* Store.waitFor(resource.state, (result) => successValue(result) === "one");
      yield* Registry.allSettled(Event.emit(resource.refresh));

      const failed = yield* Store.get(resource.state);
      assert.isTrue(AsyncResult.isFailure(failed));
      assert.strictEqual(successValue(failed), "one");
    }).pipe(Effect.provide(Registry.layer)),
  );

  it.effect("refetchOn reloads when any source emits", () =>
    Effect.gen(function* () {
      let calls = 0;
      const saved = Event.make();
      const removed = Event.make();
      const resource = yield* Resource.make(
        Effect.sync(() => {
          calls += 1;
          return calls;
        }),
      ).pipe(Resource.refetchOn(saved, removed));

      yield* Store.waitFor(resource.state, (result) => successValue(result) === 1);
      yield* Registry.allSettled(Event.emit(saved));
      assert.strictEqual(successValue(yield* Store.get(resource.state)), 2);
      yield* Registry.allSettled(Event.emit(removed));
      assert.strictEqual(successValue(yield* Store.get(resource.state)), 3);
      assert.strictEqual(calls, 3);
    }).pipe(Effect.provide(Registry.layer)),
  );

  it.effect("repeat reloads on every schedule step", () =>
    Effect.gen(function* () {
      let calls = 0;
      const resource = yield* Resource.make(
        Effect.sync(() => {
          calls += 1;
          return calls;
        }),
      ).pipe(Resource.repeat(Schedule.spaced("30 seconds")));

      yield* Store.waitFor(resource.state, (result) => successValue(result) === 1);

      yield* TestClock.adjust("30 seconds");
      yield* Store.waitFor(resource.state, (result) => successValue(result) === 2);

      yield* TestClock.adjust("30 seconds");
      yield* Store.waitFor(resource.state, (result) => successValue(result) === 3);
      assert.strictEqual(calls, 3);
    }).pipe(Effect.provide(Registry.layer)),
  );

  describe("paginated", () => {
    interface Page {
      readonly items: ReadonlyArray<number>;
      readonly next: number | null;
    }

    const fetchPage = (start: number): Page => ({
      items: [start, start + 1],
      next: start + 2 <= 5 ? start + 2 : null,
    });

    const makePaginated = Resource.make({
      stores: { pageSize: Store.make(2) },
      handler: () => Effect.sync(() => fetchPage(1)),
    }).pipe(
      Resource.paginated({
        hasMore: (_deps, current) => current.next !== null,
        next: (_deps, current) => Effect.sync(() => fetchPage(current.next ?? 0)),
        merge: (current, next) => ({
          items: [...current.items, ...next.items],
          next: next.next,
        }),
      }),
    );

    it.effect("loadMore merges pages and hasMore flips false when exhausted", () =>
      Effect.gen(function* () {
        const resource = yield* makePaginated;

        yield* Store.waitFor(resource.state, (result) => successValue(result)?.items.length === 2);
        assert.isTrue(yield* Store.get(resource.hasMore));

        yield* Registry.allSettled(Event.emit(resource.loadMore));
        assert.deepStrictEqual(successValue(yield* Store.get(resource.state))?.items, [1, 2, 3, 4]);
        assert.isTrue(yield* Store.get(resource.hasMore));

        yield* Registry.allSettled(Event.emit(resource.loadMore));
        assert.strictEqual(successValue(yield* Store.get(resource.state))?.items.length, 6);
        assert.isFalse(yield* Store.get(resource.hasMore));

        yield* Registry.allSettled(Event.emit(resource.loadMore));
        assert.strictEqual(successValue(yield* Store.get(resource.state))?.items.length, 6);
      }).pipe(Effect.provide(Registry.layer)),
    );

    it.effect("refresh resets to page 1", () =>
      Effect.gen(function* () {
        const resource = yield* makePaginated;

        yield* Store.waitFor(resource.state, (result) => successValue(result)?.items.length === 2);
        yield* Registry.allSettled(Event.emit(resource.loadMore));
        assert.strictEqual(successValue(yield* Store.get(resource.state))?.items.length, 4);

        yield* Registry.allSettled(Event.emit(resource.refresh));
        assert.deepStrictEqual(successValue(yield* Store.get(resource.state))?.items, [1, 2]);
        assert.isTrue(yield* Store.get(resource.hasMore));
      }).pipe(Effect.provide(Registry.layer)),
    );

    it.effect("loadMore during a load in flight is a no-op", () =>
      Effect.gen(function* () {
        const nextCalls: Array<number> = [];
        const gates: Array<Deferred.Deferred<Page>> = [];
        const resource = yield* Resource.make(Effect.succeed(fetchPage(1))).pipe(
          Resource.paginated({
            hasMore: (_deps, current) => current.next !== null,
            next: (_deps, current) =>
              Effect.suspend(() => {
                nextCalls.push(current.next ?? 0);
                const gate = Deferred.makeUnsafe<Page>();
                gates.push(gate);
                return Deferred.await(gate);
              }),
            merge: (current, next) => ({
              items: [...current.items, ...next.items],
              next: next.next,
            }),
          }),
        );

        yield* Store.waitFor(resource.state, (result) => successValue(result)?.items.length === 2);

        yield* Event.emit(resource.loadMore);
        yield* awaitCondition(() => nextCalls.length === 1);
        yield* Event.emit(resource.loadMore);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(nextCalls, [3]);

        const gate = gates[0];
        assert.isDefined(gate);
        if (gate !== undefined) yield* Deferred.succeed(gate, fetchPage(3));
        yield* Store.waitFor(
          resource.state,
          (result) => successValue(result)?.items.length === 4 && !result.waiting,
        );
        assert.deepStrictEqual(nextCalls, [3]);
      }).pipe(Effect.provide(Registry.layer)),
    );
  });
});
