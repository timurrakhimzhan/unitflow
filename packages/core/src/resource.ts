import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import type * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Event from "./event.js";
import { Registry } from "./registry.js";
import * as Store from "./store.js";

/**
 * A remote read owned by a model: an `AsyncResult` store fed by one loader
 * pipeline. It loads eagerly at construction, reloads on every `refresh`
 * emit, and when declared with dependency stores, reloads whenever a
 * dependency changes, handing the handler fresh dependency values each run.
 */
export interface Resource<
  A,
  E,
  Deps extends Record<string, Store.Source<any>> = Record<never, never>,
> {
  /** The full store: the owning model may override it manually
   * (`Store.set(resource.state, ...)`). */
  readonly state: Store.Store<AsyncResult.AsyncResult<A, E>>;
  /** Emitting reloads. Expose it directly as an input/ui port. */
  readonly refresh: Event.Event<void>;
  /** The declared dependency stores: combinators read fresh values here. */
  readonly stores: Deps;
}

export type DepValues<Deps> = {
  readonly [K in keyof Deps]: Deps[K] extends Store.Source<infer A> ? A : never;
};

/** A resource extended by {@link paginated}. */
export interface Paginated<A, E, Deps extends Record<string, Store.Source<any>>>
  extends Resource<A, E, Deps> {
  /** Emitting appends the next page (no-op while loading or exhausted). */
  readonly loadMore: Event.Event<void>;
  readonly hasMore: Store.Combined<boolean>;
}

export interface MakeOptions<Deps extends Record<string, Store.Source<any>>, A, E, R> {
  readonly stores?: Deps;
  readonly handler: (deps: DepValues<Deps>) => Effect.Effect<A, E, R>;
}

/**
 * Runs one fetch into an `AsyncResult` store: marks it waiting (keeping the
 * previous value on screen), then records success or failure (a failure keeps
 * the previous success, so a flaky refetch never blanks loaded data). The
 * returned effect never fails: failures are state.
 */
const load = <A, E, R>(
  store: Store.Store<AsyncResult.AsyncResult<A, E>>,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, R | Registry> =>
  Effect.gen(function* () {
    // Start the request before publishing waiting so an observer woken by the
    // waiting emission finds the request already in flight.
    const fiber = yield* Effect.forkChild(request, { startImmediately: true });
    yield* Store.update(store, (current) => AsyncResult.waiting(current));
    yield* Fiber.join(fiber).pipe(
      Effect.matchCauseEffect({
        onSuccess: (value) => Store.set(store, AsyncResult.success(value)),
        onFailure: (cause) =>
          Store.update(store, (current) =>
            AsyncResult.failureWithPrevious(cause, { previous: Option.some(current) }),
          ),
      }),
    );
  });

/** Reads the current value of every dependency store, keyed as declared. */
const depValues = <Deps extends Record<string, Store.Source<any>>>(
  stores: Deps,
): Effect.Effect<DepValues<Deps>, never, Registry> =>
  Effect.gen(function* () {
    const out: Record<string, unknown> = {};
    for (const [key, source] of Object.entries(stores)) {
      out[key] = yield* Store.get(source);
    }
    return out as DepValues<Deps>;
  });

/** Re-associates positional combine values with their dependency keys. */
const associate = <Deps>(
  keys: ReadonlyArray<string>,
  values: ReadonlyArray<unknown>,
): DepValues<Deps> => {
  const out: Record<string, unknown> = {};
  keys.forEach((key, index) => {
    out[key] = values[index];
  });
  return out as DepValues<Deps>;
};

export function make<A, E, R>(
  request: Effect.Effect<A, E, R>,
): Effect.Effect<Resource<A, E>, never, R | Registry>;
export function make<Deps extends Record<string, Store.Source<any>>, A, E, R>(
  options: MakeOptions<Deps, A, E, R>,
): Effect.Effect<Resource<A, E, Deps>, never, R | Registry>;
export function make<Deps extends Record<string, Store.Source<any>>, A, E, R>(
  requestOrOptions: Effect.Effect<A, E, R> | MakeOptions<Deps, A, E, R>,
): Effect.Effect<Resource<A, E, Deps>, never, R | Registry> {
  const stores = (Effect.isEffect(requestOrOptions) ? {} : (requestOrOptions.stores ?? {})) as Deps;
  const handler: (deps: DepValues<Deps>) => Effect.Effect<A, E, R> = Effect.isEffect(
    requestOrOptions,
  )
    ? () => requestOrOptions
    : requestOrOptions.handler;

  return Effect.gen(function* () {
    const state = Store.make<AsyncResult.AsyncResult<A, E>>(AsyncResult.initial(true));

    // The handler always receives fresh dependency values, read right before
    // each run.
    const run = Effect.flatMap(depValues(stores), (deps) => load(state, handler(deps)));

    const refresh = yield* Event.make().pipe(Event.handler(() => run));
    for (const source of Object.values(stores)) {
      yield* Registry.run(
        Store.stream(source).pipe(
          Stream.drop(1),
          Stream.mapEffect(() => run),
        ),
      );
    }

    // The initial load goes through the refresh channel so `Registry.allSettled`
    // covers construction-time loads.
    yield* Event.emit(refresh);

    return { state, refresh, stores };
  });
}

/** Forks one pipeline per source that reloads the resource whenever that
 * source emits. */
export const refetchOn =
  (...sources: ReadonlyArray<Event.Source<any>>) =>
  <R extends Resource<any, any, any>, E, Req>(
    self: Effect.Effect<R, E, Req>,
  ): Effect.Effect<R, E, Req | Registry> =>
    Effect.tap(self, (resource) =>
      Effect.forEach(
        sources,
        (source) =>
          Registry.run(
            Event.stream(source).pipe(Stream.mapEffect(() => Event.emit(resource.refresh))),
          ),
        { discard: true },
      ),
    );

/** Forks a pipeline that reloads the resource on every schedule step. */
export const repeat =
  <Out, SR>(schedule: Schedule.Schedule<Out, unknown, never, SR>) =>
  <R extends Resource<any, any, any>, E, Req>(
    self: Effect.Effect<R, E, Req>,
  ): Effect.Effect<R, E, Req | SR | Registry> =>
    Effect.tap(self, (resource) =>
      Registry.run(
        Stream.fromSchedule(schedule).pipe(Stream.mapEffect(() => Event.emit(resource.refresh))),
      ),
    );

/**
 * Extends a resource with cursorless pagination: `loadMore` fetches the next
 * page via `next` and merges it into the current value; `hasMore` reports
 * whether another page exists. `refresh` (and any dependency change) drives
 * the base loader, which replaces the state with a fresh first page.
 */
export const paginated =
  <Deps extends Record<string, Store.Source<any>>, A, E, R2>(options: {
    readonly hasMore: (deps: DepValues<Deps>, current: A) => boolean;
    readonly next: (deps: DepValues<Deps>, current: A) => Effect.Effect<A, E, R2>;
    readonly merge: (current: A, next: A) => A;
  }) =>
  <Req>(
    self: Effect.Effect<Resource<A, E, Deps>, never, Req>,
  ): Effect.Effect<Paginated<A, E, Deps>, never, Req | R2 | Registry> =>
    Effect.flatMap(self, (resource) =>
      Effect.gen(function* () {
        const depKeys = Object.keys(resource.stores);
        const depSources: ReadonlyArray<Store.Source<any>> = Object.values(resource.stores);
        const hasMore = Store.combine([resource.state, ...depSources], (current, ...values) =>
          Option.match(AsyncResult.value(current), {
            onNone: () => false,
            onSome: (value) => options.hasMore(associate<Deps>(depKeys, values), value),
          }),
        );

        const loadMore = yield* Event.make().pipe(
          Event.handler(() =>
            Effect.gen(function* () {
              const current = yield* Store.get(resource.state);
              if (current.waiting) return;
              const value = AsyncResult.value(current);
              if (Option.isNone(value)) return;
              const deps = yield* depValues(resource.stores);
              if (!options.hasMore(deps, value.value)) return;
              yield* Store.update(resource.state, (state) => AsyncResult.waiting(state));
              yield* Effect.forkChild(
                options.next(deps, value.value).pipe(
                  Effect.matchCauseEffect({
                    onSuccess: (next) =>
                      Store.set(
                        resource.state,
                        AsyncResult.success(options.merge(value.value, next)),
                      ),
                    onFailure: (cause) =>
                      Store.update(resource.state, (state) =>
                        AsyncResult.failureWithPrevious(cause, {
                          previous: Option.some(state),
                        }),
                      ),
                  }),
                ),
                { startImmediately: true },
              );
            }),
          ),
        );

        return { ...resource, loadMore, hasMore };
      }),
    );
