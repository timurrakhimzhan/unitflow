import type * as Cause from "effect/Cause";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { type Flatten, isFlatten, stateOf as flattenStateOf } from "./internals.js";
import {
  ownerScope,
  Registry,
  releaseSubscription,
  trackedStream,
  trackPublish,
  trackSubscription,
} from "./registry.js";
import { awaitFirst, evaluate, type WaitPredicate } from "./wait-for.js";

const TypeId = Symbol.for("@unitflow/core/Store");

let nextStoreId = 0;

/** The shared `.pipe(...)` implementation: descriptors are `Pipeable`, so
 * combinators compose at the declaration site. */
const PipeableProto: Pipeable = {
  pipe() {
    return pipeArguments(this, arguments);
  },
};

/** The read capability of a store: accepted by `get` and `stream`, rejected
 * by `set`. Model `outputs` and `ui` state ports are typed as `Source`. */
export interface Source<A> extends Pipeable {
  readonly [TypeId]: typeof TypeId;
  readonly id: string;
  readonly initial: A;
  readonly name?: string;
  readonly "~source": true;
}

/** The write capability of a store: accepted by `set`, rejected by `get` and
 * `stream`. Model `inputs` store ports are typed as `Sink`. */
export interface Sink<A> extends Pipeable {
  readonly [TypeId]: typeof TypeId;
  readonly id: string;
  readonly initial: A;
  readonly name?: string;
  readonly "~sink": true;
}

/** The full descriptor, held privately by the model that created it. */
export interface Store<A> extends Source<A>, Sink<A> {}

export interface Options {
  readonly name?: string;
}

export const make = <A>(initial: A, options?: Options): Store<A> => ({
  ...PipeableProto,
  [TypeId]: TypeId,
  id: `store:${++nextStoreId}`,
  initial,
  "~source": true,
  "~sink": true,
  ...(options?.name === undefined ? {} : { name: options.name }),
});

export const isStore = (value: unknown): value is Store<unknown> =>
  typeof value === "object" && value !== null && TypeId in value;

const CombinedTypeId = Symbol.for("@unitflow/core/CombinedStore");

interface CombinedState<A> {
  readonly sources: ReadonlyArray<Source<any>>;
  readonly compute: (...values: Array<any>) => A;
}

/** A combined read-only store: no state of its own — `get` computes from the
 * current source values, `stream` recombines on every source change. */
export interface Combined<A> extends Source<A> {
  readonly [CombinedTypeId]: CombinedState<A>;
}

export const isCombined = (value: unknown): value is Combined<any> =>
  typeof value === "object" && value !== null && CombinedTypeId in value;

export const sourcesOf = (store: Combined<any>): ReadonlyArray<Source<any>> =>
  store[CombinedTypeId].sources;

type SourceValues<Sources extends ReadonlyArray<Source<any>>> = {
  readonly [K in keyof Sources]: Sources[K] extends Source<infer A> ? A : never;
};

export const combine = <const Sources extends ReadonlyArray<Source<any>>, A>(
  sources: Sources,
  compute: (...values: SourceValues<Sources>) => A,
  options?: Options,
): Combined<A> => ({
  ...PipeableProto,
  [TypeId]: TypeId,
  [CombinedTypeId]: { sources, compute },
  id: `store:${++nextStoreId}`,
  // `initial` mirrors the sources' initials so pre-subscription snapshots
  // (the React binding) stay consistent with `get`.
  // eslint-disable-next-line revizo/no-type-assertion
  initial: compute(...(sources.map((source) => source.initial) as SourceValues<Sources>)),
  "~source": true,
  ...(options?.name === undefined ? {} : { name: options.name }),
});

/**
 * Data-last projection of one source, for `.pipe` chains at the declaration
 * site: `source.pipe(Store.map(f))` is `combine([source], f)` — the same
 * pull-based `get` and deduped `stream` semantics included.
 */
export const map =
  <A, B>(f: (value: A) => B, options?: Options) =>
  (source: Source<A>): Combined<B> =>
    combine([source], f, options);

export const ref = Effect.fnUntraced(function* <A>(
  store: Source<A> | Sink<A>,
): Generator<Effect.Effect<unknown, never, Registry>, SubscriptionRef.SubscriptionRef<A>, never> {
  if (isCombined(store)) {
    return yield* Effect.die(
      new Error("Unitflow combined stores are computed and have no backing ref."),
    );
  }
  if (isFlatten(store)) {
    return yield* Effect.die(
      new Error("Unitflow flattened stores are computed and have no backing ref."),
    );
  }
  const registry = yield* Registry;
  const existing = registry.stores.get(store.id);
  if (existing !== undefined) return existing;

  const owner = yield* ownerScope;
  const subscriptionRef = yield* SubscriptionRef.make(store.initial);
  registry.stores.set(store.id, subscriptionRef);
  yield* Scope.addFinalizer(
    owner,
    Effect.suspend(() => {
      registry.stores.delete(store.id);
      return PubSub.shutdown(subscriptionRef.pubsub);
    }),
  );
  return subscriptionRef;
});

export const get = <A>(store: Source<A>): Effect.Effect<A, never, Registry> => {
  if (isCombined(store)) {
    const { compute, sources } = store[CombinedTypeId];
    return Effect.map(Effect.forEach(sources, get), (values) => compute(...values));
  }
  if (isFlatten(store)) {
    const { pick, source } = flattenStateOf(store);
    // The synchronous pull path: resolve the outer composition, then every
    // picked inner source, all through the registry.
    const resolved: Effect.Effect<any, never, Registry> = Effect.flatMap(get(source), (items) =>
      Effect.forEach(items, (item) => get(pick(item))),
    );
    return resolved;
  }
  return Effect.flatMap(ref(store), SubscriptionRef.get);
};

/** Runs a `SubscriptionRef` write with the publish counted first, atomically
 * from the accounting's point of view: the count lands before the publish can
 * wake a subscriber, and interruption cannot split the pair. */
const trackedWrite = <A>(
  store: Sink<A>,
  write: (subscriptionRef: SubscriptionRef.SubscriptionRef<A>) => Effect.Effect<A>,
): Effect.Effect<A, never, Registry> =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const subscriptionRef = yield* ref(store);
    return yield* Effect.uninterruptible(
      Effect.suspend(() => {
        trackPublish(registry, store.id);
        return write(subscriptionRef);
      }),
    );
  });

export const set = <A>(store: Sink<A>, value: A): Effect.Effect<void, never, Registry> =>
  Effect.asVoid(
    trackedWrite(store, (subscriptionRef) => SubscriptionRef.setAndGet(subscriptionRef, value)),
  );

/** Sets every given store back to its initial value, in argument order. */
export const reset = (...stores: ReadonlyArray<Sink<any>>): Effect.Effect<void, never, Registry> =>
  Effect.forEach(stores, (store) => set(store, store.initial), { discard: true });

/** Reads the current value, so it requires the full store — a model updates
 * only its own state. */
export const update = <A>(
  store: Store<A>,
  f: (value: A) => A,
): Effect.Effect<void, never, Registry> =>
  Effect.asVoid(
    trackedWrite(store, (subscriptionRef) => SubscriptionRef.updateAndGet(subscriptionRef, f)),
  );

/** Reads the current value, so it requires the full store — a model updates
 * only its own state. */
export const modify = <A, B>(
  store: Store<A>,
  f: (value: A) => readonly [B, A],
): Effect.Effect<B, never, Registry> =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const subscriptionRef = yield* ref(store);
    return yield* Effect.uninterruptible(
      Effect.suspend(() => {
        trackPublish(registry, store.id);
        return SubscriptionRef.modify(subscriptionRef, f);
      }),
    );
  });

let nextFlattenSubscription = 0;

/**
 * Streams a flattened store with two-level reactivity and exact settle
 * accounting. Per subscription: one sequential tracked pipeline per source —
 * the outer composition plus each picked inner store — recomputes the current
 * array (through the synchronous pull path) into a private snapshot ref, and
 * the subscriber consumes that snapshot through its own tracked subscription.
 * A composition change closes the previous inner pipelines' scope (releasing
 * their subscriptions) and watches the new set, so a removed item's store can
 * never re-emit. The publish into the snapshot is counted before the source
 * pipeline confirms its item, so `allSettled` stays pending until the
 * subscriber has handled the recomputation — cascades included.
 */
const flattenStream = (store: Flatten<any>): Stream.Stream<any, never, Registry> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const scope = yield* Effect.scope;
      const { pick, source } = flattenStateOf(store);
      // The snapshot channel is private to this subscription: counting under
      // a shared id would count one subscriber's recomputation into another
      // subscriber's tracker and stall `allSettled`.
      const channelId = `${store.id}:subscription:${++nextFlattenSubscription}`;

      let current: ReadonlyArray<any> = yield* get(store);
      const snapshot = yield* SubscriptionRef.make(current);

      // One permit: concurrent recomputations queue, so a stale snapshot can
      // never overwrite a fresher one.
      const semaphore = yield* Semaphore.make(1);
      const recompute = semaphore.withPermit(
        Effect.flatMap(get(store), (values: ReadonlyArray<any>) =>
          Effect.suspend(() => {
            const unchanged =
              values.length === current.length &&
              values.every((value, index) => Object.is(value, current[index]));
            if (unchanged) return Effect.void;
            current = values;
            // Counted first, atomically with the publish (see `trackedWrite`).
            return Effect.uninterruptible(
              Effect.suspend(() => {
                trackPublish(registry, channelId);
                return Effect.asVoid(SubscriptionRef.setAndGet(snapshot, values));
              }),
            );
          }),
        ),
      );

      // One simple tracked source per pipeline, each consumed sequentially by
      // its own drain — the item a pipeline is handling stays pending until
      // the recomputation (and its counted snapshot publish) completed.
      const watch = (innerSource: Source<any>, target: Scope.Scope) =>
        Effect.forkIn(
          Stream.runDrain(stream(innerSource).pipe(Stream.mapEffect(() => recompute))),
          target,
          { startImmediately: true },
        );

      let innerScope: Scope.Closeable | undefined;
      const resubscribe = Effect.gen(function* () {
        if (innerScope !== undefined) yield* Scope.close(innerScope, Exit.void);
        const forked = Scope.forkUnsafe(scope);
        innerScope = forked;
        for (const item of yield* get(source)) {
          yield* watch(pick(item), forked);
        }
        yield* recompute;
      });

      // The outer pipeline replays the current composition, so the initial
      // inner watchers attach without a separate bootstrap.
      yield* Effect.forkIn(
        Stream.runDrain(stream(source).pipe(Stream.mapEffect(() => resubscribe))),
        scope,
        { startImmediately: true },
      );

      // The subscriber's own tracked subscription over the snapshot (the
      // replayed current value was never counted — see the store twin).
      const subscription = yield* PubSub.subscribe(snapshot.pubsub);
      const tracker = trackSubscription(registry, channelId, 1);
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => releaseSubscription(registry, channelId, tracker)),
      );
      return trackedStream(registry, subscription, tracker);
    }),
  );

export const stream = <A>(store: Source<A>): Stream.Stream<A, never, Registry> => {
  if (isFlatten(store)) return flattenStream(store);
  if (isCombined(store)) {
    const { compute, sources } = store[CombinedTypeId];
    return Stream.zipLatestAll(...sources.map(stream)).pipe(
      Stream.map((values) => compute(...values)),
      Stream.changes,
    );
  }
  return Stream.unwrap(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const subscriptionRef = yield* ref(store);
      const scope = yield* Effect.scope;
      // Subscribe first, register right after (see the event twin). The ref's
      // pubsub replays exactly one item — the current value — and it was
      // never counted, so it must not decrement on completion.
      const subscription = yield* PubSub.subscribe(subscriptionRef.pubsub);
      const tracker = trackSubscription(registry, store.id, 1);
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => releaseSubscription(registry, store.id, tracker)),
      );
      return trackedStream(registry, subscription, tracker);
    }),
  );
};

/** `waitFor` options without a timeout: the wait can only end with a match
 * (or the interruption/failure paths documented on {@link waitFor}). */
export interface WaitForOptions {
  /** Only subsequent emissions count: the current value is skipped. */
  readonly skipCurrent?: boolean | undefined;
  readonly timeout?: undefined;
}

/** `waitFor` options with a timeout: the wait additionally fails with
 * `Cause.TimeoutError` when no value matched in time. */
export interface WaitForTimeoutOptions {
  /** Only subsequent emissions count: the current value is skipped. */
  readonly skipCurrent?: boolean | undefined;
  readonly timeout: Duration.Input;
}

/**
 * Waits for the first store value satisfying `predicate`, resolving through
 * the registry like `get`/`stream`: the CURRENT value is checked first (pass
 * `skipCurrent: true` to only consider subsequent emissions), then every
 * emission until one matches.
 *
 * - A plain predicate keeps `E = never` (the timeout error only enters the
 *   error channel when `timeout` is passed); a refinement narrows the result.
 * - An effectful predicate runs one evaluation at a time, switching to the
 *   latest value: a value landing mid-evaluation interrupts the running check
 *   and the newest value is evaluated instead — the newest value is the
 *   store's truth, so a verdict about a superseded one is worthless. A
 *   failing predicate effect fails `waitFor` with that error.
 * - `timeout` fails with `Cause.TimeoutError` — exactly the error
 *   `Effect.timeout` raises.
 * - The store's stream ending before a match (the owning scope shut the
 *   backing ref down) interrupts the waiter: the awaited value can never
 *   arrive.
 *
 * The subscription is tracked like any `stream` subscription and released on
 * every exit path — match, predicate failure, timeout, interruption. A value
 * the predicate rejected is confirmed as handled, so a parked `waitFor` holds
 * nothing and never wedges `Registry.allSettled`.
 */
export function waitFor<A, B extends A>(
  store: Source<A>,
  predicate: (value: A) => value is B,
  options: WaitForTimeoutOptions,
): Effect.Effect<B, Cause.TimeoutError, Registry>;
export function waitFor<A, B extends A>(
  store: Source<A>,
  predicate: (value: A) => value is B,
  options?: WaitForOptions,
): Effect.Effect<B, never, Registry>;
export function waitFor<A>(
  store: Source<A>,
  predicate: (value: A) => boolean,
  options: WaitForTimeoutOptions,
): Effect.Effect<A, Cause.TimeoutError, Registry>;
export function waitFor<A>(
  store: Source<A>,
  predicate: (value: A) => boolean,
  options?: WaitForOptions,
): Effect.Effect<A, never, Registry>;
export function waitFor<A, E, R>(
  store: Source<A>,
  predicate: (value: A) => Effect.Effect<boolean, E, R>,
  options: WaitForTimeoutOptions,
): Effect.Effect<A, E | Cause.TimeoutError, Registry | R>;
export function waitFor<A, E, R>(
  store: Source<A>,
  predicate: (value: A) => Effect.Effect<boolean, E, R>,
  options?: WaitForOptions,
): Effect.Effect<A, E, Registry | R>;
export function waitFor(
  store: Source<any>,
  predicate: WaitPredicate<any>,
  options?: WaitForOptions | WaitForTimeoutOptions,
): Effect.Effect<any, any, any> {
  const emissions = options?.skipCurrent === true ? Stream.drop(stream(store), 1) : stream(store);
  return awaitFirst(
    emissions.pipe(
      // Switch-to-latest: a new value interrupts the in-flight evaluation.
      Stream.switchMap((value) =>
        Stream.fromEffect(evaluate(predicate, value)).pipe(
          Stream.filter((matched) => matched),
          Stream.map(() => value),
        ),
      ),
    ),
    options?.timeout,
  );
}
