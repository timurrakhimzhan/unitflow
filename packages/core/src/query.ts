import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import type * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import type * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Event from "./event.js";
import { makeSlot, type PersistOptions } from "./persistence.js";
import { InstanceScope, Registry } from "./registry.js";
import * as Store from "./store.js";

/**
 * A remote read owned by a model: an `AsyncResult` store fed by one loader
 * pipeline. It loads eagerly at construction, reloads on every `refresh`
 * emit, and when declared with dependency stores, reloads whenever a
 * dependency changes, handing the handler fresh dependency values each run.
 */
export interface Query<
  A,
  E,
  Deps extends Record<string, Store.Output<any>> = Record<never, never>,
> {
  /** The full store: the owning model may override it manually
   * (`Store.set(query.state, ...)`). */
  readonly state: Store.Store<AsyncResult.AsyncResult<A, E>>;
  /** The last value the handler returned, `None` until the first success.
   *
   * It answers "what did we last load", not "what is loaded now": it survives
   * a dependency change (so a screen may keep the previous list on-screen
   * while the next one loads) and a failed reload, and it does not say which
   * dependency values produced it. Read {@link state} instead whenever
   * showing data from the previous dependencies would be wrong — there,
   * `!waiting` means the value answers the current dependencies. */
  readonly data: Store.Output<Option.Option<A>>;
  /** Emitting reloads. Safe to expose as a `ui` port directly; as an
   * `inputs` port, go through `Event.toInput(query.refresh)` — the query's
   * own construction (and the owning model, freely) still emits this exact
   * event elsewhere, so it can't be narrowed to `Event.input()`. */
  readonly refresh: Event.Event<void>;
  /** The declared dependency stores: combinators read fresh values here. */
  readonly stores: Deps;
}

export type DepValues<Deps> = {
  readonly [K in keyof Deps]: Deps[K] extends Store.Output<infer A> ? A : never;
};

/** A query created by {@link makeInfinite}: its state is the flat
 * concatenation of every loaded page. */
export interface Paginated<
  Item,
  E,
  Deps extends Record<string, Store.Output<any>> = Record<never, never>,
> extends Query<ReadonlyArray<Item>, E, Deps> {
  /** Emitting appends the next page (no-op while loading or exhausted). */
  readonly loadMore: Event.Event<void>;
  /** Whether another page exists, derived from the last page's `next`. */
  readonly hasMore: Store.Combined<boolean>;
}

export interface MakeOptions<Deps extends Record<string, Store.Output<any>>, A, E, R> {
  readonly stores?: Deps;
  readonly handler: (deps: DepValues<Deps>) => Effect.Effect<A, E, R>;
}

/** One page from a {@link makeInfinite} handler: the items plus the cursor of
 * the next page — `Option.some(cursor)` when another page exists,
 * `Option.none()` when exhausted. */
export interface PageResult<Item, Cursor> {
  readonly data: ReadonlyArray<Item>;
  readonly next: Option.Option<Cursor>;
}

export interface InfiniteOptions<
  Deps extends Record<string, Store.Output<any>>,
  Item,
  Cursor,
  E,
  R,
> {
  readonly stores?: Deps;
  /** The cursor of the first page — `refresh` and dependency changes restart
   * from it. Doubles as the inference anchor for the cursor type: token
   * cursors start from `null as string | null`. */
  readonly initialCursor: Cursor;
  /** Fetches one page: `cursor` is `initialCursor` for the first page,
   * afterwards the previous page's `next`. */
  readonly handler: (
    deps: DepValues<Deps>,
    cursor: Cursor,
  ) => Effect.Effect<PageResult<Item, Cursor>, E, R>;
}

/**
 * The bookkeeping every loader of one query shares: which answer is still
 * wanted, and which fiber is producing it.
 *
 * A query has exactly one answer in flight. Whatever supersedes it — a
 * dependency change, and for a paginated query a restart — ends its
 * generation: the fiber is cancelled and anything it would still write is
 * dropped. Without that, the answer that finished last won, rather than the
 * one released last.
 */
interface Generations<A, E> {
  readonly state: Store.Store<AsyncResult.AsyncResult<A, E>>;
  readonly data: Store.Store<Option.Option<A>>;
  /** Ends the current generation and returns the new one. */
  readonly supersedeUnsafe: () => number;
  /** The generation a write must still belong to for it to land. */
  readonly current: () => number;
  /** Adopts `fiber` as the answer in flight of the current generation. */
  readonly hold: (fiber: Fiber.Fiber<unknown, unknown>) => void;
  readonly release: (fiber: Fiber.Fiber<unknown, unknown>) => void;
}

/**
 * Runs one fetch into a query's stores: marks the state waiting (keeping the
 * previous value on screen for a reload of the same dependencies), then
 * records success or failure. A failure keeps the previous success, so a
 * flaky refetch never blanks loaded data, and `data` is left alone entirely —
 * it holds what the endpoint last returned, not what the last attempt did.
 *
 * Writes land only while this run is still the wanted one; a superseded run
 * finishes silently. The returned effect never fails: failures are state.
 */
const load = <A, E, R>(
  generations: Generations<A, E>,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, R | Registry> =>
  Effect.gen(function* () {
    const generation = generations.supersedeUnsafe();
    const wanted = () => generations.current() === generation;
    // Start the request before publishing waiting so an observer woken by the
    // waiting emission finds the request already in flight.
    const fiber = yield* Effect.forkChild(request, { startImmediately: true });
    generations.hold(fiber);
    if (wanted()) {
      yield* Store.update(generations.state, (current) => AsyncResult.waiting(current));
    }
    yield* Fiber.join(fiber).pipe(
      Effect.matchCauseEffect({
        onSuccess: (value) =>
          wanted()
            ? Effect.andThen(
                Store.set(generations.state, AsyncResult.success(value)),
                Store.set(generations.data, Option.some(value)),
              )
            : Effect.void,
        onFailure: (cause) =>
          // A superseded run is cancelled, so its interruption is bookkeeping,
          // not an error the query should show.
          wanted() && !Cause.hasInterruptsOnly(cause)
            ? Store.update(generations.state, (current) =>
                AsyncResult.failureWithPrevious(cause, { previous: Option.some(current) }),
              )
            : Effect.void,
      }),
    );
    generations.release(fiber);
  });

/** The writable side of every query's `data`, which the public interface
 * exposes read-only. `persist` needs it to seed a restored value; nothing
 * outside this module can reach it. */
const dataStores = new WeakMap<
  Query<any, any, any>,
  Store.Store<Option.Option<any>>
>();

/** Reads the current value of every dependency store, keyed as declared. */
const depValues = <Deps extends Record<string, Store.Output<any>>>(
  stores: Deps,
): Effect.Effect<DepValues<Deps>, never, Registry> =>
  Effect.gen(function* () {
    const out: Record<string, unknown> = {};
    for (const [key, source] of Object.entries(stores)) {
      out[key] = yield* Store.get(source);
    }
    return out as DepValues<Deps>;
  });

/** The query plus the bookkeeping `makeInfinite` extends: page loads join the
 * same generations, and a dependency change resets the cursor in the same
 * dispatch that resets the state. */
interface Base<A, E, Deps extends Record<string, Store.Output<any>>> {
  readonly query: Query<A, E, Deps>;
  readonly generations: Generations<A, E>;
}

interface BaseOptions {
  /** Runs inside the dispatch of the dependency write, right before the state
   * is reset: whatever else must not survive the old dependencies. */
  readonly onDependencyChangeUnsafe?: () => void;
}

/** Builds the shared query skeleton: an `AsyncResult` store fed by `request`,
 * reloaded on `refresh` and on every dependency change. */
const base = <Deps extends Record<string, Store.Output<any>>, A, E, R>(
  stores: Deps,
  request: (deps: DepValues<Deps>) => Effect.Effect<A, E, R>,
  options?: BaseOptions,
): Effect.Effect<Base<A, E, Deps>, never, R | Registry | InstanceScope> =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const state = Store.make<AsyncResult.AsyncResult<A, E>>(AsyncResult.initial(true));
    const data = Store.make<Option.Option<A>>(Option.none());
    // Materialized up front: the dependency listener below writes the state
    // without leaving the dispatch, and a synchronous write needs the ref.
    yield* Store.ref(state);

    let generation = 0;
    let inFlight: Fiber.Fiber<unknown, unknown> | undefined;
    const generations: Generations<A, E> = {
      state,
      data,
      supersedeUnsafe: () => {
        generation += 1;
        const superseded = inFlight;
        inFlight = undefined;
        superseded?.interruptUnsafe();
        return generation;
      },
      current: () => generation,
      hold: (fiber) => {
        inFlight = fiber;
      },
      release: (fiber) => {
        if (inFlight === fiber) inFlight = undefined;
      },
    };

    // The handler always receives fresh dependency values, read right before
    // each run.
    const run = Effect.flatMap(depValues(stores), (deps) =>
      load(generations, request(deps)),
    );

    const refresh = yield* Event.make().pipe(Event.handler(() => run));
    const refreshChannel = yield* Event.pubsub(refresh);

    for (const source of Object.values(stores)) {
      // Structural equality, matching the `Stream.changes` a `Store.stream`
      // subscription applied before: a recomputed dependency that is equal to
      // the old one (a combined store rebuilding `Option.some({ id })` from
      // an unrelated write) is not a change and must not refetch.
      yield* Store.onChangeUnsafe(source, () => {
        // In the dispatch of the dependency write itself: no observer, not
        // even a synchronous one, can read the answer to the old dependencies
        // under the new ones. The value is gone rather than merely flagged
        // stale, so `!waiting` means "answers the current dependencies".
        // What the endpoint last returned stays in `data` for whoever wants
        // to keep it on screen.
        generations.supersedeUnsafe();
        options?.onDependencyChangeUnsafe?.();
        Store.setUnsafeNow(registry, state, AsyncResult.initial(true));
        // Dispatched, not emitted: the reload has to be counted against
        // `Registry.allSettled` from inside this same step.
        Event.dispatchUnsafe(registry, refreshChannel, refresh, undefined);
      }, { equals: Equal.equals });
    }

    // The initial load goes through the refresh channel so `Registry.allSettled`
    // covers construction-time loads.
    yield* Event.emit(refresh);

    const query: Query<A, E, Deps> = { state, data, refresh, stores };
    dataStores.set(query, data);
    return { query, generations };
  });

/**
 * Builds a paginated query around one page handler. The base loader fetches
 * the first page (`cursor === initialCursor`) and records the next cursor;
 * `loadMore` fetches with that cursor and appends. The cursor never leaks
 * into the state: it is bookkeeping, not data.
 */
export const makeInfinite = <
  Deps extends Record<string, Store.Output<any>>,
  Item,
  Cursor,
  E,
  R,
>(
  options: InfiniteOptions<Deps, Item, Cursor, E, R>,
): Effect.Effect<Paginated<Item, E, Deps>, never, R | Registry | InstanceScope> =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const stores = (options.stores ?? {}) as Deps;
    // `None` means exhausted or nothing loaded yet. Updated only on
    // successful loads, so a failed page leaves `loadMore` retryable.
    const cursor = Store.make<Option.Option<Cursor>>(Option.none());
    yield* Store.ref(cursor);

    const { query, generations } = yield* base<Deps, ReadonlyArray<Item>, E, R | Registry>(
      stores,
      (deps) =>
        options.handler(deps, options.initialCursor).pipe(
          Effect.tap((page) => Store.set(cursor, page.next)),
          Effect.map((page) => page.data),
        ),
      {
        // A cursor belongs to the dependencies that produced it: continuing
        // from it under new ones would append a stranger's page.
        onDependencyChangeUnsafe: () => {
          Store.setUnsafeNow(registry, cursor, Option.none());
        },
      },
    );

    const hasMore = Store.combine([cursor], Option.isSome);

    const loadMore = yield* Event.make().pipe(
      Event.handler(() =>
        Effect.gen(function* () {
          const current = yield* Store.get(query.state);
          if (current.waiting) return;
          if (Option.isNone(AsyncResult.value(current))) return;
          const next = yield* Store.get(cursor);
          if (Option.isNone(next)) return;
          const deps = yield* depValues(stores);
          // A page extends the answer the current generation is building: it
          // joins that generation rather than starting one, but it is still
          // the query's one fetch in flight, so a dependency change cancels it.
          const generation = generations.current();
          const wanted = () => generations.current() === generation;
          yield* Store.update(query.state, (state) => AsyncResult.waiting(state));
          const fiber = yield* Effect.forkChild(
            options.handler(deps, next.value).pipe(
              Effect.matchCauseEffect({
                onSuccess: (page) =>
                  wanted()
                    ? Effect.gen(function* () {
                        yield* Store.set(cursor, page.next);
                        // Appended to what the store holds now, not to the
                        // list captured when this page was requested.
                        const items = yield* Store.modify(query.state, (state) => {
                          const appended = [
                            ...Option.getOrElse(
                              AsyncResult.value(state),
                              (): ReadonlyArray<Item> => [],
                            ),
                            ...page.data,
                          ];
                          return [appended, AsyncResult.success(appended)];
                        });
                        yield* Store.set(generations.data, Option.some(items));
                      })
                    : Effect.void,
                onFailure: (cause) =>
                  wanted() && !Cause.hasInterruptsOnly(cause)
                    ? Store.update(query.state, (state) =>
                        AsyncResult.failureWithPrevious(cause, { previous: Option.some(state) }),
                      )
                    : Effect.void,
              }),
            ),
            { startImmediately: true },
          );
          generations.hold(fiber);
        }),
      ),
    );

    const paginated: Paginated<Item, E, Deps> = { ...query, loadMore, hasMore };
    dataStores.set(paginated, generations.data);
    return paginated;
  });

export function make<A, E, R>(
  request: Effect.Effect<A, E, R>,
): Effect.Effect<Query<A, E>, never, R | Registry | InstanceScope>;
export function make<Deps extends Record<string, Store.Output<any>>, A, E, R>(
  options: MakeOptions<Deps, A, E, R>,
): Effect.Effect<Query<A, E, Deps>, never, R | Registry | InstanceScope>;
export function make(
  requestOrOptions:
    | Effect.Effect<any, any, any>
    | MakeOptions<Record<string, Store.Output<any>>, any, any, any>,
): Effect.Effect<any, never, any> {
  return Effect.map(
    Effect.isEffect(requestOrOptions)
      ? base({}, () => requestOrOptions)
      : base(requestOrOptions.stores ?? {}, requestOrOptions.handler),
    ({ query }) => query,
  );
}

/** Forks one pipeline per source that reloads the query whenever that
 * source emits. */
export const refetchOn =
  (...sources: ReadonlyArray<Event.Output<any>>) =>
  <R extends Query<any, any, any>, E, Req>(
    self: Effect.Effect<R, E, Req>,
  ): Effect.Effect<R, E, Req | Registry | InstanceScope> =>
    Effect.tap(self, (query) =>
      Effect.forEach(
        sources,
        (source) =>
          Registry.run(
            Event.stream(source).pipe(Stream.mapEffect(() => Event.emit(query.refresh))),
          ),
        { discard: true },
      ),
    );

/**
 * Persists every settled success into a `KeyValueStore` under `key`, and on
 * construction seeds the state from the stored copy while the initial load is
 * still in flight (stale-while-revalidate). Best-effort: storage and codec
 * failures are logged as warnings and never affect the query itself. A stored
 * entry that fails to decode — or is older than `timeToLive` — is a miss.
 * A load that settles (success or failure) before the restore completes wins:
 * settled network state is fresher information than the stored copy.
 */
export const persist =
  <A, I>(options: PersistOptions<A, I>) =>
  <Q extends Query<A, any, any>, Req>(
    self: Effect.Effect<Q, never, Req>,
  ): Effect.Effect<Q, never, Req | KeyValueStore.KeyValueStore | Registry | InstanceScope> =>
    Effect.tap(self, (query) =>
      Effect.gen(function* () {
        const slot = yield* makeSlot(options);

        // Seed only while the initial load has not settled, and keep the
        // waiting flag: the load fired at construction is still in flight.
        // The stored copy is the last answer we know of, so it seeds `data`
        // as well — a view that reads `data` to tolerate staleness is exactly
        // the one that should see a restored value.
        const data = dataStores.get(query);
        const seed = Effect.flatMap(
          slot.load,
          Option.match({
            onNone: () => Effect.void,
            onSome: (value) =>
              Effect.gen(function* () {
                yield* Store.update(query.state, (current) =>
                  AsyncResult.isInitial(current)
                    ? AsyncResult.waiting(AsyncResult.success(value))
                    : current,
                );
                if (data === undefined) return;
                yield* Store.update(data, (current) =>
                  Option.isNone(current) ? Option.some(value) : current,
                );
              }),
          }),
        );

        // The seed pipeline starts first so the save subscription below never
        // observes state older than the seeded value; the seeded state itself
        // is marked waiting, so it is not echoed back into the store.
        yield* Registry.run(Stream.fromEffect(seed));
        yield* Registry.run(
          Store.stream(query.state).pipe(
            Stream.filter(
              (result): result is AsyncResult.Success<A, any> =>
                AsyncResult.isSuccess(result) && !result.waiting,
            ),
            Stream.mapEffect((result) => slot.save(result.value)),
          ),
        );
      }),
    );

/** Forks a pipeline that reloads the query on every schedule step. */
export const repeat =
  <Out, SR>(schedule: Schedule.Schedule<Out, unknown, never, SR>) =>
  <R extends Query<any, any, any>, E, Req>(
    self: Effect.Effect<R, E, Req>,
  ): Effect.Effect<R, E, Req | SR | Registry | InstanceScope> =>
    Effect.tap(self, (query) =>
      Registry.run(
        Stream.fromSchedule(schedule).pipe(Stream.mapEffect(() => Event.emit(query.refresh))),
      ),
    );
