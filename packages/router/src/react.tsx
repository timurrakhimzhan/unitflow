import * as React from "react";
import { type Model, View as UnitView } from "@unitflow/react";
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
 * contextual typing of plain function entries. */
export interface ModelViewEntry {
  readonly model: Model.AnyService;
}

type BoundaryComponent<M extends Router.AnyRouter = Router.RegisteredRouter> = (props: {
  readonly router: BoundRouter<M>;
  readonly match?: Router.RouteMatch;
  readonly error?: unknown;
}) => React.ReactNode;

type RouteById<M extends Router.AnyRouter, Id> = Extract<
  Router.RouterRoutes<M>,
  { readonly id: Id }
>;



/**
 * The one place a router meets rendering: a route only declares `model` (or
 * nothing) — never a component. This map supplies the actual view for each
 * route id, plus the pending/error/not-found boundaries, entirely outside
 * `@unitflow/router` itself. Keys are constrained to the router's actual
 * route ids (a typo will not compile), and each view's `match` is narrowed
 * to ITS route's params/search types.
 */
export interface RouterViews<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  Units = void,
> {
  readonly routes: {
    readonly [Id in Router.RouteIds<Router.RouterGroupOf<M>>]?:
      | RouteComponent<M, Router.RouteMatch<RouteById<M, Id>>, Units>
      | ModelViewEntry;
  };
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
    <MatchRenderer router={router} views={views} units={units} pages={pages} state={state} index={0} />
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

const makeRouterView = <M extends Router.AnyRouter, Units = void>(
  router: M,
  views: RouterViews<M, Units>,
): RouterViewComponent<M, Units> => {
  // Stitch: pull the models out of the views map and let the router build
  // its pages model around them.
  const pageModels: Record<string, Model.AnyService> = {};
  for (const [routeId, entry] of Object.entries(views.routes)) {
    if (typeof entry === "function" && "model" in entry) {
      pageModels[routeId] = (entry as ModelViewEntry).model;
    }
  }
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

export const RouterView = { make: makeRouterView };
export const View = RouterView;

const MatchRenderer = <M extends Router.AnyRouter, Units = void>({
  router,
  views,
  units,
  pages,
  state,
  index,
}: {
  readonly router: BoundRouter<M>;
  readonly views: RouterViews<M, Units>;
  readonly units: Units;
  readonly pages: Readonly<Record<string, unknown>>;
  readonly state: Router.RouterState<Router.RouterRoutes<M>>;
  readonly index: number;
}): React.ReactNode => {
  const match = state.matches[index] as unknown as Router.RouteMatch | undefined;
  if (match === undefined) return null;
  // The runtime id is erased to `string`; the map itself is keyed strictly.
  // eslint-disable-next-line revizo/no-type-assertion
  const entry = (
    views.routes as Readonly<
      Record<string, RouteComponent<M, any, Units> | ModelViewEntry | undefined>
    >
  )[match.route.id];
  const child = (
    <MatchRenderer
      router={router}
      views={views}
      units={units}
      pages={pages}
      state={state}
      index={index + 1}
    />
  );
  if (entry === undefined) return child;
  if ("model" in entry) {
    // A model-bound view: its unit was leased by the pages model.
    const PageView = entry as unknown as React.FC<{
      readonly unit: unknown;
      readonly children?: React.ReactNode;
    }>;
    return (
      <PageView unit={pages[match.route.id]}>{child}</PageView>
    );
  }
  const RouteView = entry;
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
