import type * as Cause from "effect/Cause";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import * as Event from "./event.js";
import { Registry } from "./registry.js";
import * as Store from "./store.js";

const ResourceTypeId = Symbol.for("@unitflow/core/Resource");
const ResourceOptionsTypeId: unique symbol = Symbol.for("@unitflow/core/Resource/Options") as never;

type StoreRecord = Readonly<Record<string, Store.Source<any>>>;

type StoreValues<Stores extends StoreRecord> = {
  readonly [K in keyof Stores]: Stores[K] extends Store.Source<infer A> ? A : never;
};

type MaybeEffect<A, E, R> = A | Effect.Effect<A, E, R>;

export type AsyncResult<A, E = unknown> =
  | { readonly _tag: "Waiting" }
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly cause: Cause.Cause<E> };

export namespace AsyncResult {
  export const waiting = <A = never, E = never>(): AsyncResult<A, E> => ({
    _tag: "Waiting",
  });

  export const success = <A, E = never>(value: A): AsyncResult<A, E> => ({
    _tag: "Success",
    value,
  });

  export const failure = <E, A = never>(cause: Cause.Cause<E>): AsyncResult<A, E> => ({
    _tag: "Failure",
    cause,
  });
}

/**
 * A resource is a store-shaped descriptor so `View.make` binds it as the
 * current `AsyncResult`, while its `reload` command is available as an event
 * sink for inputs/ui commands.
 */
export interface Resource<A, E = unknown> extends Store.Store<AsyncResult<A, E>> {
  readonly reload: Event.Sink<void>;
  readonly [ResourceTypeId]: typeof ResourceTypeId;
}

interface ResourcePipeOptions {
  debounce?: Duration.Input;
}

export interface ResourceEffect<A, E, R> extends Effect.Effect<Resource<A, E>, never, R> {
  readonly [ResourceOptionsTypeId]: ResourcePipeOptions;
}

export interface Options<Stores extends StoreRecord, A, E, R> {
  readonly name?: string;
  readonly stores?: Stores;
  readonly handler: (values: StoreValues<Stores>) => MaybeEffect<A, E, R>;
}

const runMaybe = <A, E, R>(
  evaluate: () => MaybeEffect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const value = evaluate();
    return Effect.isEffect(value) ? value : Effect.succeed(value);
  });

const readValues = <Stores extends StoreRecord>(
  entries: ReadonlyArray<readonly [string, Store.Source<any>]>,
): Effect.Effect<StoreValues<Stores>, never, Registry> =>
  Effect.map(
    Effect.forEach(entries, ([key, store]) =>
      Effect.map(Store.get(store), (value) => [key, value] as const),
    ),
    (values) => Object.fromEntries(values) as StoreValues<Stores>,
  );

const valuesEqual = <Stores extends StoreRecord>(
  left: StoreValues<Stores>,
  right: StoreValues<Stores>,
): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.is(left[key], right[key]))
  );
};

const watchSources = (source: Store.Source<any>): ReadonlyArray<Store.Source<any>> =>
  Store.isCombined(source) ? Store.sourcesOf(source).flatMap(watchSources) : [source];

const uniqueSources = (
  sources: ReadonlyArray<Store.Source<any>>,
): ReadonlyArray<Store.Source<any>> => [...new Map(sources.map((source) => [source.id, source])).values()];

export const make = <
  const Stores extends StoreRecord = Record<never, never>,
  A = never,
  E = never,
  R = never,
>(
  options: Options<Stores, A, E, R>,
): ResourceEffect<A, E, R | Registry> => {
  const pipeOptions: ResourcePipeOptions = {};
  const effect = Effect.gen(function* () {
    const state = Store.make<AsyncResult<A, E>>(
      AsyncResult.waiting(),
      options.name === undefined ? undefined : { name: options.name },
    );
    const entries = Object.entries(options.stores ?? {}) as ReadonlyArray<
      readonly [string, Store.Source<any>]
    >;

    let generation = 0;
    let lastValues = yield* readValues<Stores>(entries);

    const run = (values: StoreValues<Stores>): Effect.Effect<void, never, R | Registry> =>
      Effect.gen(function* () {
        const current = ++generation;
        yield* Store.set(state, AsyncResult.waiting());
        const exit = yield* Effect.exit(runMaybe(() => options.handler(values)));
        if (current !== generation) return;
        if (Exit.isSuccess(exit)) {
          yield* Store.set(state, AsyncResult.success(exit.value));
          return;
        }
        yield* Store.set(state, AsyncResult.failure(exit.cause));
      });

    const runCurrent: Effect.Effect<void, never, R | Registry> = Effect.flatMap(
      readValues<Stores>(entries),
      (values) =>
        Effect.flatMap(
          Effect.sync(() => {
            lastValues = values;
          }),
          () => run(values),
        ),
    );

    const reload = yield* Event.make<void>(
      options.name === undefined ? undefined : { name: `${options.name}.reload` },
    ).pipe(Event.handler(() => runCurrent));

    if (entries.length > 0) {
      const sources = uniqueSources(entries.flatMap(([, store]) => watchSources(store)));
      yield* Effect.forEach(
        sources,
        (store) => {
          const changes =
            pipeOptions.debounce === undefined
              ? Store.stream(store)
              : Store.stream(store).pipe(Stream.debounce(pipeOptions.debounce));
          return Registry.run(
            changes.pipe(
              Stream.mapEffect(() =>
                Effect.flatMap(readValues<Stores>(entries), (values) => {
                  if (valuesEqual(values, lastValues)) return Effect.void;
                  lastValues = values;
                  return run(values);
                }),
              ),
            ),
          );
        },
        { discard: true },
      );
    }

    yield* Event.emit(reload);

    return Object.assign(state, {
      reload,
      [ResourceTypeId]: ResourceTypeId,
    }) as Resource<A, E>;
  });
  return Object.assign(effect, { [ResourceOptionsTypeId]: pipeOptions });
};

export const isResource = (value: unknown): value is Resource<unknown, unknown> =>
  typeof value === "object" && value !== null && ResourceTypeId in value;

export function debounce(
  duration: Duration.Input,
): <A, E, R>(resource: ResourceEffect<A, E, R>) => ResourceEffect<A, E, R>;
export function debounce<A, E, R>(
  resource: ResourceEffect<A, E, R>,
  duration: Duration.Input,
): ResourceEffect<A, E, R>;
export function debounce<A, E, R>(
  resourceOrDuration: ResourceEffect<A, E, R> | Duration.Input,
  duration?: Duration.Input,
):
  | ResourceEffect<A, E, R>
  | (<A2, E2, R2>(resource: ResourceEffect<A2, E2, R2>) => ResourceEffect<A2, E2, R2>) {
  if (duration === undefined) {
    return (resource) => debounce(resource, resourceOrDuration as Duration.Input);
  }
  const resource = resourceOrDuration as ResourceEffect<A, E, R>;
  resource[ResourceOptionsTypeId].debounce = duration;
  return resource;
}
