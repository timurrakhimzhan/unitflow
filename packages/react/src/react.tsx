import type * as Cause from "effect/Cause";
import * as React from "react";
import { Event, Model, Store } from "@unitflow/core";
import { ModelResult, type UnitflowRuntime } from "@unitflow/core/runtime";

const RuntimeContext = React.createContext<UnitflowRuntime<any, any> | null>(null);

const useUnitflowRuntime = (): UnitflowRuntime<any, any> => {
  const runtime = React.useContext(RuntimeContext);
  if (runtime === null) {
    throw new Error("Unitflow hooks require a <Unitflow> root above them.");
  }
  return runtime;
};

/** Subscribe to a store's current value. */
export const useStore = <A,>(store: Store.Output<A>): A => {
  const runtime = useUnitflowRuntime();
  const subscribe = React.useCallback(
    (listener: () => void) => runtime.subscribeStore(store, listener),
    [runtime, store],
  );
  const getSnapshot = React.useCallback(() => runtime.getStore(store), [runtime, store]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/** A stable callback that emits the event through the runtime. */
export const useEvent = <A,>(event: Event.Input<A>): ((...args: Event.EmitArgs<A>) => void) => {
  const runtime = useUnitflowRuntime();
  return React.useCallback(
    (...args: Event.EmitArgs<A>) => runtime.emit(event, ...args),
    [runtime, event],
  );
};

/** Leases ANY model by key and re-renders on its construction state —
 * `Building` while `make` (or a layer it needs) is still resolving,
 * `Ready` once leased, `Failed` on a construction error. One lease per
 * mounted call, released on unmount (idle TTL keeps the instance alive
 * across quick remounts) — see `subscribeModel` in `@unitflow/core/runtime`.
 * `useRootUnit` below is this with the root's fixed `void` key. */
export const useModel = <M extends Model.AnyService>(
  model: M,
  key: Model.KeyOf<M>,
): ModelResult<Model.PortsOf<M>, Model.ErrorOf<M>> => {
  const runtime = useUnitflowRuntime();
  const subscribe = React.useCallback(
    (listener: () => void) => runtime.subscribeModel(model, key, listener),
    [runtime, model, key],
  );
  const getSnapshot = React.useCallback(() => runtime.getModel(model, key), [runtime, model, key]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/** Leases the root model and re-renders on its construction state. */
const useRootUnit = <M extends Model.Viewable>(
  runtime: UnitflowRuntime<any, any>,
  rootModel: M,
): ModelResult<Model.PortsOf<M>, Model.ErrorOf<M>> => {
  // The root model is a singleton, whose key is `void`.
  // eslint-disable-next-line revizo/no-type-assertion
  const key = undefined as Model.KeyOf<M>;
  const subscribe = React.useCallback(
    (listener: () => void) => runtime.subscribeModel(rootModel, key, listener),
    [runtime, rootModel, key],
  );
  const getSnapshot = React.useCallback(
    () => runtime.getModel(rootModel, key),
    [runtime, rootModel, key],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

const RootUnit = <M extends Model.Viewable>({
  runtime,
  rootModel,
  building,
  failed,
  children,
}: UnitflowProps<M>): React.ReactNode => {
  const resolved = useRootUnit(runtime, rootModel);
  return ModelResult.$match(resolved, {
    Ready: ({ model }) => children(model),
    Failed: ({ cause }) => failed?.(cause) ?? null,
    Building: () => building ?? null,
  });
};

export interface UnitflowProps<M extends Model.Viewable> {
  readonly runtime: UnitflowRuntime<any, any>;
  /** The singleton model whose unit bootstraps the tree. */
  readonly rootModel: M;
  /** Rendered while the root unit is constructing (async `make` or layer
   * build). */
  readonly building?: React.ReactNode;
  /** Rendered when the root construction failed. Defaults to nothing —
   * construction failures are configuration bugs, not UI states. */
  readonly failed?: (cause: Cause.Cause<Model.ErrorOf<M>>) => React.ReactNode;
  readonly children: (unit: Model.PortsOf<M>) => React.ReactNode;
}

/**
 * The single meeting point of React and the Unitflow runtime: provides the
 * runtime to every hook below and leases the root model, handing its unit to
 * `children`. All other units flow down from here — a parent model owns its
 * children and republishes their ports through `ui`; a View can never summon
 * an instance from JSX.
 */
export const Unitflow = <M extends Model.Viewable>(props: UnitflowProps<M>): React.ReactNode => (
  <RuntimeContext.Provider value={props.runtime}>
    <RootUnit {...props} />
  </RuntimeContext.Provider>
);

/** Every View renders a unit handed to it — by its parent View (from the
 * owning model's `ui`) or, for the root, by `Unitflow`. */
export interface ViewProps<M extends Model.AnyService> {
  readonly unit: Model.PortsOf<M>;
}

/** A `ui` record bound for rendering: store outputs arrive as their current
 * values, event inputs as fire callbacks, everything else (nested child
 * units) untouched. */
export type BoundUi<Ui> = {
  readonly [K in keyof Ui]: Ui[K] extends Store.Output<infer A>
    ? A
    : Ui[K] extends Event.Input<infer A>
      ? (...args: Event.EmitArgs<A>) => void
      : Ui[K];
};

let nextBoundId = 0;
const boundIds = new WeakMap<object, number>();

/** A stable identity per unit object — the `key` that remounts `Bound` when
 * the View switches to another instance. */
const boundId = (unit: object): number => {
  const existing = boundIds.get(unit);
  if (existing !== undefined) return existing;
  const id = ++nextBoundId;
  boundIds.set(unit, id);
  return id;
};

/** Binds a raw `ui` record for rendering: store outputs become their
 * current (reactive) values, event inputs become fire callbacks, everything
 * else passes through unchanged — one hook per entry, so `ui`'s KEY SET
 * must stay the same across renders for one call site (true for a model's
 * own `ui` shape, fixed per model class). What `View.make`'s `Bound`
 * component uses internally; exported so other renderers (e.g. the
 * router's self-leasing route views) can bind a `ui` record the same way without
 * duplicating the per-entry hook logic. */
export const useBoundUi = <Ui extends Record<string, unknown>>(ui: Ui): BoundUi<Ui> => {
  const units: Record<string, unknown> = {};
  for (const [key, port] of Object.entries(ui)) {
    if (Store.isStore(port)) {
      units[key] = useStore(port);
    } else if (Event.isEvent(port) && "~sink" in port) {
      units[key] = useEvent(port);
    } else {
      units[key] = port;
    }
  }
  // Built entry by entry from the same record the mapped type describes.
  // eslint-disable-next-line revizo/no-type-assertion
  return units as BoundUi<Ui>;
};

/** A model-bound view's own Building/Failed rendering, for the
 * {@link makeView} overload that leases a {@link Model.Keyed} model itself
 * rather than receiving an already-resolved `unit` prop. Both default to
 * rendering nothing — construction failures are configuration bugs, not UI
 * states, same default as {@link Unitflow}'s own `failed`. */
export interface KeyedViewOptions<E = unknown> {
  readonly building?: React.ReactNode;
  readonly failed?: (cause: Cause.Cause<E>) => React.ReactNode;
}

/** Every View a {@link Model.Keyed} model gets bound to receives its own
 * key this way — not `key`, React's own reserved prop name for
 * reconciliation, so it can never be read back out of `props`. */
export interface KeyedViewProps<M extends Model.AnyService> {
  readonly modelKey: Model.KeyOf<M>;
  readonly children?: React.ReactNode;
}

/** Marks a `View.make` result built via the self-leasing (keyed) overload —
 * distinguishes it, from the value alone, from a plain `unit`-prop
 * `ViewProps` component. For a consumer that walks a tree of `View.make`
 * results without rendering them (e.g. the router's routes map) and needs to
 * know whether a given entry expects `unit` (pre-resolved by a parent) or
 * `modelKey` (leases itself) — see {@link isSelfLeasedView}. */
const SelfLeasedTypeId = Symbol.for("@unitflow/react/SelfLeasedView");

/** True for a `View.make(Model, render, options)` result — the self-leasing
 * overload, `options` (even `{}`) included at the call site. */
export const isSelfLeasedView = (value: unknown): boolean =>
  typeof value === "object" && value !== null && SelfLeasedTypeId in value;

export function makeView<M extends Model.Viewable, P extends object = Record<never, never>>(
  model: M,
  render: (units: BoundUi<Model.PortsOf<M>["ui"]>, props: P) => React.ReactNode,
): React.FC<ViewProps<M> & P> & { readonly model: M };
/** Not restricted to singletons above: a keyed model resolved by a PARENT
 * (`Model.get(Keyed, key)` inside the parent's own `make()`) is handed down
 * as an already-resolved `unit` the same way a singleton child is — see
 * `TaskModel` in the docs' composition example. The `options` argument
 * (required, even `{}`) is what selects THIS overload instead — a keyed
 * model used here means "lease it yourself, by key", not "singleton vs
 * keyed". */
export function makeView<
  M extends Model.Keyed<any> & Model.Viewable,
  P extends object = Record<never, never>,
>(
  model: M,
  render: (
    units: BoundUi<Model.PortsOf<M>["ui"]>,
    props: P & { readonly children?: React.ReactNode },
  ) => React.ReactNode,
  options: KeyedViewOptions<Model.ErrorOf<M>>,
): React.FC<KeyedViewProps<M> & P> & { readonly model: M };
export function makeView(
  model: Model.AnyService,
  render: (units: Record<string, unknown>, props: Record<string, unknown>) => React.ReactNode,
  options?: KeyedViewOptions,
): React.FC<Record<string, unknown>> & { readonly model: Model.AnyService } {
  // Keyed by the ports object, so a Bound instance always sees one and the
  // same ui record: it is created once in `make` and never mutated, hence
  // `useBoundUi`'s per-entry hooks keep a fixed order for the component's
  // lifetime.
  const Bound = ({
    ui,
    extra,
  }: {
    readonly ui: Record<string, unknown>;
    readonly extra: Record<string, unknown>;
  }): React.ReactNode => render(useBoundUi(ui), extra);

  // `options` is fixed at `makeView`'s own call site, not per-render — this
  // component always takes the same branch on every render, so calling
  // `useModel` in only one of them never violates the rules of hooks.
  const Component = (props: Record<string, unknown>): React.ReactNode => {
    if (options === undefined) {
      // eslint-disable-next-line revizo/no-type-assertion
      const { unit, ...extra } = props as { readonly unit: Model.UnitPorts } & Record<string, unknown>;
      return <Bound key={boundId(unit)} ui={unit.ui} extra={extra} />;
    }
    // eslint-disable-next-line revizo/no-type-assertion
    const { modelKey, children, ...extra } = props as {
      readonly modelKey: unknown;
      readonly children?: React.ReactNode;
    } & Record<string, unknown>;
    const result = useModel(model, modelKey);
    return ModelResult.$match(result, {
      Building: () => options.building ?? null,
      Failed: ({ cause }) => options.failed?.(cause) ?? null,
      Ready: ({ model: ports }) => (
        <Bound
          key={boundId(ports)}
          // The public overload requires `Model.Viewable` (`ui` always
          // present); this erased implementation signature doesn't carry
          // that guarantee through to the type checker.
          // eslint-disable-next-line revizo/no-type-assertion
          ui={ports.ui as Record<string, unknown>}
          // eslint-disable-next-line revizo/no-type-assertion
          extra={{ ...extra, children } as Record<string, unknown>}
        />
      ),
    });
  };
  Component.displayName = `View(${model.modelKey})`;
  // The view carries its model: composition layers (e.g. a router's views
  // map) can lease the model themselves and hand the unit back in. The
  // self-leasing branch also carries `SelfLeasedTypeId`, so such a
  // composition layer can tell it apart from a `unit`-prop entry by the
  // value alone — see `isSelfLeasedView`.
  return Object.assign(Component, options === undefined ? { model } : { model, [SelfLeasedTypeId]: true });
}

/**
 * Pairs a model with its View: a pure projection of the unit it receives.
 * The render callback gets the model's `ui` already bound as `units`: store
 * outputs arrive as current values, event inputs as fire callbacks, and
 * nested child units pass through unchanged. No hooks needed in the callback — and
 * `inputs`/`outputs` stay invisible to JSX.
 *
 * A `Model.Keyed` model needs a third argument (`{ building?, failed? }`,
 * `{}` included) to opt into leasing itself directly — see
 * {@link KeyedViewOptions}. Without one, the returned component instead
 * expects an already-resolved `unit` prop, same as a singleton model.
 */
export const View = { make: makeView };
