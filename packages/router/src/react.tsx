import * as React from "react";
import { type BoundUi, type Model, useBoundUi, useModel, View as UnitView } from "@unitflow/react";
import { ModelResult } from "@unitflow/core/runtime";
import * as Router from "./router.js";

type Controller<M extends Router.AnyRouter> = Router.RouterControllerOf<M>;

export interface BoundRouter<M extends Router.AnyRouter = Router.RegisteredRouter> {
  /** Phantom inference anchor: every other occurrence of `M` here sits
   * behind a conditional type (`RouterRoutes<M>` etc.) TypeScript cannot
   * invert, so without this marker `M` silently falls back to its default
   * and `Link`/`MatchRoute` props stop being route-typed. Never set at
   * runtime. */
  readonly "~model"?: M;
  readonly state: Router.RouterState<Router.RouterRoutes<M>>;
  readonly location: Router.ParsedLocation;
  readonly matches: ReadonlyArray<Router.MatchUnion<M>>;
  readonly api: Controller<M>;
  readonly navigate: (
    options: Router.NavigateOptions<Controller<M>, Router.RoutePath<Controller<M>>>,
  ) => void;
}

export type RouteComponent<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  Match extends Router.RouteMatch = Router.MatchUnion<M>,
  Units = void,
> = (props: {
  readonly router: BoundRouter<M>;
  readonly match: Match;
  /** Extra units the OWNING view passed through `RouterView`'s `units`
   * prop — for anything that is not a route's page model. */
  readonly units: Units;
  readonly children: React.ReactNode;
}) => React.ReactNode;

/** A model-bound view (what `View.make` returns): dropping it straight
 * into the routes map makes the router lease its model and hand the unit
 * back in — `user: UserPage` is the whole stitching. Deliberately typed
 * WITHOUT a call signature: a second callable union member would destroy
 * contextual typing of plain function entries.
 *
 * `model` is `Model.Singleton`: `makePages` leases it with `Model.get`, no
 * key — see {@link Router.PageMap}. For a model that needs its route's
 * `Route.Output` from the FIRST line of its own `make` (no placeholder, no
 * race — see {@link RouteFedModelViewEntry}), key it by that `Route.Output`
 * instead. */
export interface ModelViewEntry {
  readonly model: Model.Singleton;
}

/** A model-bound view whose model is KEYED by its own route's
 * `Route.Output` — leased lazily, exactly when the route first matches,
 * with the guard's Provides as the key (`useModel` in `@unitflow/react`,
 * not `makePages`'s eager singleton path). `make(provided)` gets real,
 * typed, non-`Option` data on its first line: no placeholder is ever
 * constructed, because the model isn't constructed AT ALL until the real
 * value exists. Renders nothing while the lease is still resolving
 * (`ModelResult.Building` — ordinarily one microtask, unless `make` itself
 * does async work). */
export interface RouteFedModelViewEntry<R extends Router.Route.Any> {
  readonly model: Model.Keyed<Router.Route.Output<R>>;
}

const RouteFedTypeId = Symbol.for("@unitflow/router/RouteFedView");

/** Pairs a `Route.Output`-keyed model with its View — the `routeView`
 * counterpart of `@unitflow/react`'s `View.make`, for a
 * {@link RouteFedModelViewEntry}. Unlike `View.make`, it never receives a
 * `unit` prop: `MatchRenderer` hands it the matched route's `provided`
 * value instead, and the component leases the model itself
 * (`useModel(model, provided)`) — real data from the very first render,
 * nothing to forward in from outside. Renders nothing while the lease is
 * still resolving or if it fails; `render` only ever runs once `Ready`. */
const makeRouteView = <M extends Model.Keyed<any>, P extends object = Record<never, never>>(
  model: M,
  render: (
    units: BoundUi<Model.PortsOf<M>["ui"]>,
    props: P & { readonly children?: React.ReactNode },
  ) => React.ReactNode,
): React.FC<{ readonly provided: Model.KeyOf<M>; readonly children?: React.ReactNode } & P> & {
  readonly model: M;
} => {
  const Bound = ({
    ui,
    extra,
  }: {
    readonly ui: Record<string, unknown>;
    readonly extra: P & { readonly children?: React.ReactNode };
  }): React.ReactNode =>
    // eslint-disable-next-line revizo/no-type-assertion
    render(useBoundUi(ui) as BoundUi<Model.PortsOf<M>["ui"]>, extra);

  const Component = (
    props: { readonly provided: Model.KeyOf<M>; readonly children?: React.ReactNode } & P,
  ): React.ReactNode => {
    const { provided, children, ...extra } = props;
    const result = useModel(model, provided);
    return ModelResult.$match(result, {
      Building: () => null,
      Failed: () => null,
      Ready: ({ model: ports }) => (
        <Bound
          // eslint-disable-next-line revizo/no-type-assertion
          ui={ports.ui as Record<string, unknown>}
          // eslint-disable-next-line revizo/no-type-assertion
          extra={{ ...extra, children } as unknown as P & { readonly children?: React.ReactNode }}
        />
      ),
    });
  };
  Component.displayName = `RouteView(${model.modelKey})`;
  return Object.assign(Component, { model, [RouteFedTypeId]: true });
};

export const routeView = makeRouteView;

type BoundaryComponent<M extends Router.AnyRouter = Router.RegisteredRouter> = (props: {
  readonly router: BoundRouter<M>;
  readonly match?: Router.RouteMatch;
  readonly error?: unknown;
}) => React.ReactNode;

type RouteById<M extends Router.AnyRouter, Id> = Extract<
  Router.RouterRoutes<M>,
  { readonly id: Id }
>;

/** What a route id may bind to: a plain component, a model-bound view (see
 * {@link ModelViewEntry}, {@link RouteFedModelViewEntry}), or — when that
 * route has declared children via `Route.addChild`/`Route.layout` — a
 * `{ view, routes }` node whose nested `routes` mirrors those children
 * one-to-one. `view` still renders the matched descendant as `children`,
 * exactly like the flat shorthand does. */
export type RouteNode<
  M extends Router.AnyRouter,
  Id extends Router.RouteIds<Router.RouterGroupOf<M>>,
  Units,
> =
  | RouteComponent<M, Router.RouteMatch<RouteById<M, Id>>, Units>
  | ModelViewEntry
  | RouteFedModelViewEntry<RouteById<M, Id>>
  | {
      readonly view:
        | RouteComponent<M, Router.RouteMatch<RouteById<M, Id>>, Units>
        | ModelViewEntry
        | RouteFedModelViewEntry<RouteById<M, Id>>;
      readonly routes?: RoutesConfig<M, Units>;
    };

export type RoutesConfig<M extends Router.AnyRouter = Router.RegisteredRouter, Units = void> = {
  readonly [Id in Router.RouteIds<Router.RouterGroupOf<M>>]?: RouteNode<M, Id, Units>;
};

/**
 * The one place a router meets rendering: a route only declares `model` (or
 * nothing) — never a component. This map supplies the actual view for each
 * route id, plus the pending/error/not-found boundaries, entirely outside
 * `@unitflow/router` itself. Keys are constrained to the router's actual
 * route ids (a typo will not compile), and each view's `match` is narrowed
 * to ITS route's params/search types. Nesting a `{ view, routes }` node
 * under a route mirrors that route's declared `Route.addChild`/`Route.layout`
 * children — a plain entry (no `routes`) leaves any deeper match unwrapped.
 */
export interface RouterViews<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  Units = void,
> {
  readonly routes: RoutesConfig<M, Units>;
  readonly pending?: BoundaryComponent<M>;
  readonly error?: BoundaryComponent<M>;
  readonly notFound?: BoundaryComponent<M>;
}

export interface MatchesProps<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  Units = void,
> {
  readonly router: BoundRouter<M>;
  readonly views: RouterViews<M, Units>;
  readonly units: Units;
  readonly pages: Readonly<Record<string, unknown>>;
}

const renderBoundary = <M extends Router.AnyRouter>(
  Component: BoundaryComponent<M> | undefined,
  router: BoundRouter<M>,
  state: Router.RouterState<Router.RouterRoutes<M>>,
): React.ReactNode => {
  if (Component === undefined) return null;
  const match = state.matches.at(-1) as unknown as Router.RouteMatch | undefined;
  return match === undefined
    ? <Component router={router} error={state.error} />
    : <Component router={router} match={match} error={state.error} />;
};

export function Matches<M extends Router.AnyRouter = Router.RegisteredRouter, Units = void>({
  router,
  views,
  units,
  pages,
}: MatchesProps<M, Units>): React.ReactNode {
  const state = router.state as Router.RouterState<Router.RouterRoutes<M>>;
  if (state.status === "error") return renderBoundary(views.error, router, state);
  if (state.status === "not-found") return renderBoundary(views.notFound, router, state);
  if (state.status === "pending" && state.matches.length === 0) {
    return views.pending === undefined ? null : <>{views.pending({ router })}</>;
  }
  return (
    <MatchRenderer router={router} nodes={views.routes} units={units} pages={pages} state={state} index={0} />
  );
}

/** The extra prop the router view takes when its views need child units:
 * absent for `Units = void`, required otherwise. */
type UnitsProp<Units> = [Units] extends [void]
  ? { readonly units?: undefined }
  : { readonly units: Units };

/** What `RouterView.make` returns: the outlet component, carrying the
 * pages model it should be rooted with (`rootModel={AppView.model}`). */
export type RouterViewComponent<M extends Router.AnyRouter, Units> = React.FC<
  { readonly unit: Model.UnitPorts } & UnitsProp<Units>
> & {
  /** The root model for this view tree: owns the router and every page
   * model stitched into the views map. */
  readonly model: Router.PagesModel<
    Router.RouterIdOf<M>,
    Router.RouterGroupOf<M>,
    Router.PageMap<Router.RouterGroupOf<M>>
  >;
};

/** True for a `routeView(...)` result — distinguished from a plain
 * `View.make(...)` `ModelViewEntry` by this marker: both are callable with
 * a `.model` static, so `collectPageModels`/`MatchRenderer` need an actual
 * runtime signal, not just shape, to tell "lease eagerly via `makePages`"
 * apart from "lease lazily via `useModel`, keyed by `Route.Output`". */
const isRouteFedView = (value: unknown): boolean =>
  typeof value === "object" && value !== null && RouteFedTypeId in value;

/** Walks the (possibly nested) routes config collecting every route id's
 * EAGER (singleton) page model, wherever in the tree it's declared — a
 * `{ view, routes }` node's own `view` counts just like a top-level
 * shorthand entry does. A `routeView(...)` entry is skipped: it leases its
 * own model lazily, keyed by the match — see {@link isRouteFedView}. */
const collectPageModels = (
  nodes: Readonly<Record<string, unknown>>,
  into: Record<string, Model.AnyService>,
): void => {
  for (const [routeId, entry] of Object.entries(nodes)) {
    if (entry === undefined) continue;
    if (typeof entry === "function" && "model" in entry) {
      if (!isRouteFedView(entry)) into[routeId] = (entry as ModelViewEntry).model;
      continue;
    }
    if (typeof entry === "object" && entry !== null && "view" in entry) {
      const node = entry as { readonly view: unknown; readonly routes?: Readonly<Record<string, unknown>> };
      if (typeof node.view === "function" && "model" in node.view && !isRouteFedView(node.view)) {
        into[routeId] = (node.view as ModelViewEntry).model;
      }
      if (node.routes !== undefined) collectPageModels(node.routes, into);
    }
  }
};

const makeRouterView = <
  M extends Router.AnyRouter,
  Units = void,
  const Views extends RouterViews<M, Units> = RouterViews<M, Units>,
>(
  router: M,
  views: Views,
): RouterViewComponent<M, Units> => {
  // Stitch: pull the models out of the views map and let the router build
  // its pages model around them. Every entry's model type was already
  // checked against its route id by `RouteNode`/`RouteById` in the `views`
  // parameter's own type, so this runtime-built map is safe to hand to
  // `makePages` opaquely; nothing left to re-verify here.
  const pageModels: Record<string, Model.AnyService> = {};
  collectPageModels(views.routes as Readonly<Record<string, unknown>>, pageModels);
  const pagesModel = Router.makePages(router, pageModels as never);

  const Bound = UnitView.make(
    // The pages model carries its router value (typed opaquely — cycle
    // breaker); the inner view binds the ROUTER unit for state/navigation.
    pagesModel.router as never,
    (
      bound,
      extra: { readonly forwardedUnits: Units; readonly pages: Readonly<Record<string, unknown>> },
    ) => (
      <BoundRouterContext.Provider value={bound as BoundRouter<M>}>
        <Matches
          router={bound as BoundRouter<M>}
          views={views}
          units={extra.forwardedUnits}
          pages={extra.pages}
        />
      </BoundRouterContext.Provider>
    ),
  );
  const Component = (props: {
    readonly unit: Model.UnitPorts;
    readonly units?: Units;
  }): React.ReactNode => {
    // pages.ui = { router: <router unit>, ...page units by route id }.
    const pagesUi = props.unit.ui as Readonly<Record<string, unknown>>;
    return (
      <Bound
        unit={pagesUi["router"] as never}
        forwardedUnits={props.units as Units}
        pages={pagesUi}
      />
    );
  };
  Component.displayName = "RouterView";
  return Object.assign(Component, { model: pagesModel }) as never;
};

/** True for a `{ view, routes }` tree node — distinguished from a bare
 * `RouteComponent`/`ModelViewEntry` entry by NOT being callable: both of
 * those are always functions (a `ModelViewEntry` is `View.make`'s callable
 * result with a `.model` static, same shape `RouterViewComponent` itself
 * has), while a nesting node is a plain object literal. */
const isRouteTreeNode = (
  value: unknown,
): value is { readonly view: unknown; readonly routes?: Readonly<Record<string, unknown>> } =>
  typeof value === "object" && value !== null && "view" in value;

const MatchRenderer = <M extends Router.AnyRouter, Units = void>({
  router,
  nodes,
  units,
  pages,
  state,
  index,
}: {
  readonly router: BoundRouter<M>;
  readonly nodes: Readonly<Record<string, unknown>>;
  readonly units: Units;
  readonly pages: Readonly<Record<string, unknown>>;
  readonly state: Router.RouterState<Router.RouterRoutes<M>>;
  readonly index: number;
}): React.ReactNode => {
  const match = state.matches[index] as unknown as Router.RouteMatch | undefined;
  if (match === undefined) return null;
  // The runtime id is erased to `string`; the map itself is keyed strictly.
  const entry = nodes[match.route.id];
  const isNode = isRouteTreeNode(entry);
  const view = entry === undefined ? undefined : isNode ? entry.view : entry;
  // A node without a declared `routes` sub-tree (or no entry at all) has
  // nothing to look up a deeper match against — descendants beyond that
  // point render unwrapped, mirroring the flat map's old "no entry" case.
  const nextNodes = isNode && entry.routes !== undefined ? entry.routes : {};
  // `null` (not an empty renderer element) when no deeper match exists, so
  // a layout's `children ?? fallback` — and a parent page deciding between
  // its own content and a child's — actually work.
  const child =
    index + 1 < state.matches.length ? (
      <MatchRenderer
        router={router}
        nodes={nextNodes}
        units={units}
        pages={pages}
        state={state}
        index={index + 1}
      />
    ) : null;
  if (view === undefined) return child;
  if (isRouteFedView(view)) {
    // A routeView(...) entry: leases its own model lazily, keyed by this
    // match's Route.Output — no unit from `pages` to pass in.
    const RouteFedView = view as unknown as React.FC<{
      readonly provided: unknown;
      readonly children?: React.ReactNode;
    }>;
    return (
      <RouteFedView provided={match.provided}>{child}</RouteFedView>
    );
  }
  if ("model" in (view as object)) {
    // A model-bound view: its unit was leased by the pages model.
    const PageView = view as unknown as React.FC<{
      readonly unit: unknown;
      readonly children?: React.ReactNode;
    }>;
    return (
      <PageView unit={pages[match.route.id]}>{child}</PageView>
    );
  }
  const RouteView = view as RouteComponent<M, any, Units>;
  return (
    <RouteView router={router} match={match as never} units={units}>
      {child}
    </RouteView>
  );
};

type AnchorProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href">;

type LinkState = {
  readonly isActive: boolean;
  readonly isTransitioning: boolean;
};

type StateProps = AnchorProps & { readonly [key: `data-${string}`]: unknown };

/** The bound router `RouterView` provides to everything it renders, so
 * `Link`/`Navigate`/`MatchRoute` need no `router` prop under it. NOT a way
 * for views to summon models — the value is the already-bound unit the
 * RouterView owns; this only spares threading it through every level. */
const BoundRouterContext = React.createContext<BoundRouter<any> | null>(null);

const useBoundRouter = (explicit: BoundRouter<any> | undefined, who: string): BoundRouter<any> => {
  const fromContext = React.useContext(BoundRouterContext);
  const router = explicit ?? fromContext;
  if (router === null || router === undefined) {
    throw new Error(`Unitflow ${who} needs a RouterView above it (or an explicit router prop).`);
  }
  return router;
};

export type LinkProps<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
> = AnchorProps &
  Router.NavigateOptions<M, To> & {
    /** Only needed OUTSIDE a RouterView (or with several routers): under
     * one, the bound router arrives via context and types come from the
     * registered router. */
    readonly router?: BoundRouter<M>;
    readonly children?: React.ReactNode | ((state: LinkState) => React.ReactNode);
    readonly activeProps?: StateProps | (() => StateProps);
    readonly inactiveProps?: StateProps | (() => StateProps);
  };

export type LinkComponent = <
  M extends Router.AnyRouter = Router.RegisteredRouter,
  const To extends Router.RoutePath<M> = Router.RoutePath<M>,
>(
  props: LinkProps<M, To> & { readonly ref?: React.Ref<HTMLAnchorElement> },
) => React.ReactElement;

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps<any, any>>(function Link(props, ref) {
  const {
    router: routerProp,
    activeProps,
    inactiveProps,
    children,
    onClick,
    ...rest
  } = props;

  const router = useBoundRouter(routerProp, "Link");
  const href = router.api.buildHref(rest as never);
  const isActive = router.api.matchRoute(rest as never);
  const stateProps = resolveStateProps(isActive ? activeProps : inactiveProps);

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (shouldHandleClick(event, props)) {
      event.preventDefault();
      router.navigate(rest as never);
    }
  };

  const renderedChildren =
    typeof children === "function" ? children({ isActive, isTransitioning: false }) : children;

  return (
    <a
      {...mergeProps(rest, stateProps)}
      href={href}
      ref={ref}
      data-status={isActive ? "active" : undefined}
      onClick={handleClick}
    >
      {renderedChildren}
    </a>
  );
}) as LinkComponent;

export type NavigateProps<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
> = Router.NavigateOptions<M, To> & {
  readonly router?: BoundRouter<M>;
};

export function Navigate<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
>(props: NavigateProps<M, To>): null {
  const { router: routerProp, ...options } = props;
  const router = useBoundRouter(routerProp, "Navigate");
  const navigate = router.navigate;
  React.useEffect(() => {
    navigate(options as never);
    // Re-fires only on a new target, not on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, JSON.stringify(options)]);
  return null;
}

export type MatchRouteProps<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
> = Router.ToOptions<M, To> &
  Router.ActiveOptions & {
    readonly router?: BoundRouter<M>;
    readonly children?:
      | React.ReactNode
      | ((state: { readonly isActive: boolean }) => React.ReactNode);
  };

export function MatchRoute<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  const To extends Router.RoutePath<M> = Router.RoutePath<M>,
>(props: MatchRouteProps<M, To>): React.ReactNode {
  const { router: routerProp, children, ...rest } = props;
  const router = useBoundRouter(routerProp, "MatchRoute");
  const isActive = router.api.matchRoute(rest as never);
  if (typeof children === "function") return children({ isActive });
  return isActive ? children : null;
}

/** `Link`/`Navigate`/`MatchRoute` pick up their bound router from React
 * context at runtime — a mechanism TypeScript cannot see through, so their
 * `to`/`params`/`search` typing needs SOME static source. `Router.Register`
 * (a `declare module` ambient default) is one; this is the structural
 * alternative — pass `AppRouter.model` once and get back the SAME runtime
 * components, just narrowed to that router's type, no ambient state. */
export interface BoundComponents<M extends Router.AnyRouter> {
  readonly Link: <const To extends Router.RoutePath<M> = Router.RoutePath<M>>(
    props: LinkProps<M, To> & { readonly ref?: React.Ref<HTMLAnchorElement> },
  ) => React.ReactElement;
  readonly Navigate: <const To extends Router.RoutePath<M> = Router.RoutePath<M>>(
    props: NavigateProps<M, To>,
  ) => null;
  readonly MatchRoute: <const To extends Router.RoutePath<M> = Router.RoutePath<M>>(
    props: MatchRouteProps<M, To>,
  ) => React.ReactNode;
}

/** Re-types the existing `Link`/`Navigate`/`MatchRoute` — not new
 * components, no behavior change, no runtime cost: `router` is only read
 * for its TYPE, never touched. */
const bindComponents = <M extends Router.AnyRouter>(router: M): BoundComponents<M> => {
  void router;
  return { Link, Navigate, MatchRoute } as unknown as BoundComponents<M>;
};

export const RouterView = { make: makeRouterView, bindComponents };
export const View = RouterView;

export type CreatedLinkComponent = <
  M extends Router.AnyRouter = Router.RegisteredRouter,
  const To extends Router.RoutePath<M> = Router.RoutePath<M>,
>(
  props: LinkProps<M, To> & { readonly ref?: React.Ref<HTMLAnchorElement> },
) => React.ReactElement;

export const createLink = <Props extends AnchorProps,>(
  Component: React.ComponentType<Props & React.RefAttributes<HTMLAnchorElement>>,
): CreatedLinkComponent =>
  React.forwardRef<HTMLAnchorElement, LinkProps<any, any>>(function CreatedLink(props, ref) {
    const { router: routerProp, ...rest } = props;
    const router = useBoundRouter(routerProp, "createLink");
    const href = router.api.buildHref(rest as never);
    return <Component {...(rest as unknown as Props)} href={href} ref={ref} />;
  }) as CreatedLinkComponent;

export const linkOptions = <const Options,>(options: Options): Options => options;

const resolveStateProps = (
  props: StateProps | (() => StateProps) | undefined,
): StateProps | undefined => (typeof props === "function" ? props() : props);

const mergeProps = (base: AnchorProps, state: StateProps | undefined): AnchorProps => {
  if (state === undefined) return base;
  return {
    ...base,
    ...state,
    className: [base.className, state.className].filter(Boolean).join(" ") || undefined,
    style: { ...base.style, ...state.style },
  };
};

const shouldHandleClick = (
  event: React.MouseEvent<HTMLAnchorElement>,
  props: AnchorProps & { readonly reloadDocument?: boolean },
): boolean => {
  if (event.defaultPrevented) return false;
  if (props.reloadDocument === true) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
  if (props.target !== undefined && props.target !== "_self") return false;
  if (props.download !== undefined) return false;
  return true;
};
