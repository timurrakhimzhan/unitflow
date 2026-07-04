import type * as Cause from "effect/Cause";
import * as Equal from "effect/Equal";
import * as React from "react";
import { Event, Model, Store } from "@unitflow/core";
import { type ModelResult, ModelResult as ModelResultEnum, type ModelRuntime } from "@unitflow/core/runtime";

const RuntimeContext = React.createContext<ModelRuntime<any, any> | null>(null);

export function ModelRuntimeProvider({
  runtime,
  children,
}: {
  readonly runtime: ModelRuntime<any, any>;
  readonly children: React.ReactNode;
}) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export const useModelRuntime = (): ModelRuntime<any, any> => {
  const runtime = React.useContext(RuntimeContext);
  if (runtime === null) {
    throw new Error("Unitflow hooks require a <ModelRuntimeProvider> above them.");
  }
  return runtime;
};

/** Subscribe to a store's current value. */
export const useStore = <A,>(store: Store.Source<A>): A => {
  const runtime = useModelRuntime();
  const subscribe = React.useCallback(
    (listener: () => void) => runtime.subscribeStore(store, listener),
    [runtime, store],
  );
  const getSnapshot = React.useCallback(() => runtime.getStore(store), [runtime, store]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/** A stable callback that emits the event through the runtime. */
export const useEvent = <A,>(event: Event.Sink<A>): ((...args: Event.EmitArgs<A>) => void) => {
  const runtime = useModelRuntime();
  return React.useCallback(
    (...args: Event.EmitArgs<A>) => runtime.emit(event, ...args),
    [runtime, event],
  );
};

const noSubscription = () => undefined;

const building: ModelResult<never, never> = ModelResultEnum.Building();

/** Resolve a unit by key through the runtime; `enabled: false` keeps the hook
 * order stable when the unit's ports were passed in directly. */
const useUnit = <M extends Model.AnyService>(
  model: M,
  key: Model.KeyOf<M>,
  enabled: boolean,
): ModelResult<Model.PortsOf<M>, Model.ErrorOf<M>> => {
  const runtime = useModelRuntime();
  // Object keys are usually rebuilt every render; pin the first structurally
  // equal key object so it is a stable hook dependency (keys are immutable
  // plain data, so `Equal.equals` decides identity).
  const keyRef = React.useRef(key);
  if (!Equal.equals(keyRef.current, key)) keyRef.current = key;
  const stableKey = keyRef.current;
  const subscribe = React.useCallback(
    (listener: () => void) =>
      enabled ? runtime.subscribeModel(model, stableKey, listener) : noSubscription,
    [runtime, model, stableKey, enabled],
  );
  const getSnapshot = React.useCallback(
    () => (enabled ? runtime.getModel(model, stableKey) : building),
    [runtime, model, stableKey, enabled],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export interface ViewOptions<E> {
  /** Rendered while the unit is constructing (async `make` or layer build). */
  readonly building?: React.ReactNode;
  /** Rendered when the unit's construction failed. Defaults to nothing —
   * construction failures are configuration bugs, not UI states. */
  readonly failed?: (cause: Cause.Cause<E>) => React.ReactNode;
}

/** The unit comes either from a parent that already holds its ports (`unit`)
 * or is resolved from the registry by its stable key (`unitKey` — a flat
 * plain-data key validated by `Model.KeyInput`). */
export type ViewProps<M extends Model.AnyService> =
  | { readonly unit: Model.PortsOf<M>; readonly unitKey?: never }
  | ({ readonly unit?: never } & ([Model.KeyOf<M>] extends [void]
      ? { readonly unitKey?: void }
      : { readonly unitKey: Model.KeyInput<Model.KeyOf<M>> }));

/** A `ui` ports record bound for rendering: store sources arrive as their
 * current values, event sinks as fire callbacks, everything else (nested
 * unit ports) untouched. */
export type BoundUi<Ui> = {
  readonly [K in keyof Ui]: Ui[K] extends Store.Source<infer A>
    ? A
    : Ui[K] extends Event.Sink<infer A>
      ? (...args: Event.EmitArgs<A>) => void
      : Ui[K];
};

let nextBoundId = 0;
const boundIds = new WeakMap<object, number>();

/** A stable identity per ports object — the `key` that remounts `Bound` when
 * the View switches to another instance. */
const boundId = (ports: object): number => {
  const existing = boundIds.get(ports);
  if (existing !== undefined) return existing;
  const id = ++nextBoundId;
  boundIds.set(ports, id);
  return id;
};

const makeView = <M extends Model.AnyService, P extends object = Record<never, never>>(
  model: M,
  render: (units: BoundUi<Model.PortsOf<M>["ui"]>, props: P) => React.ReactNode,
  options?: ViewOptions<Model.ErrorOf<M>>,
): React.FC<ViewProps<M> & P> => {
  // Keyed by the ports object, so a Bound instance always sees one and the
  // same ui record: it is created once in `make` and never mutated, hence the
  // per-entry hooks below keep a fixed order for the component's lifetime.
  const Bound = ({
    ui,
    extra,
  }: {
    readonly ui: Record<string, unknown>;
    readonly extra: P;
  }): React.ReactNode => {
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
    return render(units as BoundUi<Model.PortsOf<M>["ui"]>, extra);
  };

  const Component = (props: ViewProps<M> & P): React.ReactNode => {
    // `unitKey` is `KeyOf<M> | undefined` across the props union; the runtime
    // representation is always the single key value. The remaining props are
    // the View's own presentation props.
    // eslint-disable-next-line revizo/no-type-assertion
    const { unit, unitKey, ...extra } = props as {
      readonly unit?: Model.PortsOf<M>;
      readonly unitKey?: Model.KeyOf<M>;
    } & P;
    // eslint-disable-next-line revizo/no-type-assertion
    const key = unitKey as Model.KeyOf<M>;
    const resolved = useUnit(model, key, unit === undefined);
    const ports = unit ?? (resolved._tag === "Ready" ? resolved.model : undefined);
    if (ports !== undefined) {
      // eslint-disable-next-line revizo/no-type-assertion
      return <Bound key={boundId(ports)} ui={ports.ui} extra={extra as P} />;
    }
    if (resolved._tag === "Failed") return options?.failed?.(resolved.cause) ?? null;
    return options?.building ?? null;
  };
  Component.displayName = `View(${model.modelKey})`;
  return Component;
};

/**
 * Pairs a model with its View. The render callback receives the model's `ui`
 * ports already bound as `units`: store sources arrive as their current
 * values, event sinks as fire callbacks, nested unit ports untouched (pass
 * them to child Views via `unit`). No hooks needed in the callback — and
 * `inputs`/`outputs` stay invisible to JSX.
 */
export const View = { make: makeView };
