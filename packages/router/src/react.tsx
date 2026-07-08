import * as React from "react";
import { View as UnitView, type ViewProps } from "@unitflow/react";
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
  /** Child units the OWNING view passed through `RouterView`'s `units`
   * prop — the model-first way for a route view to reach its page model:
   * the parent leases and republishes, the view only receives. */
  readonly units: Units;
  readonly children: React.ReactNode;
}) => React.ReactNode;

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
    readonly [Id in Router.RouteIds<Router.RouterGroupOf<M>>]?: RouteComponent<
      M,
      Router.RouteMatch<RouteById<M, Id>>,
      Units
    >;
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
}: MatchesProps<M, Units>): React.ReactNode {
  const state = router.state as Router.RouterState<Router.RouterRoutes<M>>;
  if (state.status === "error") return renderBoundary(views.error, router, state);
  if (state.status === "not-found") return renderBoundary(views.notFound, router, state);
  if (state.status === "pending" && state.matches.length === 0) {
    return views.pending === undefined ? null : <>{views.pending({ router })}</>;
  }
  return <MatchRenderer router={router} views={views} units={units} state={state} index={0} />;
}

/** The extra prop the router view takes when its views need child units:
 * absent for `Units = void`, required otherwise. */
type UnitsProp<Units> = [Units] extends [void]
  ? { readonly units?: undefined }
  : { readonly units: Units };

const makeRouterView = <M extends Router.AnyRouter, Units = void>(
  router: M,
  views: RouterViews<M, Units>,
): React.FC<ViewProps<M> & UnitsProp<Units>> => {
  const Bound = UnitView.make(
    router as never,
    (bound, extra: { readonly forwardedUnits: Units }) => (
      <Matches router={bound as BoundRouter<M>} views={views} units={extra.forwardedUnits} />
    ),
  );
  const Component = (props: ViewProps<M> & UnitsProp<Units>): React.ReactNode => (
    <Bound unit={props.unit as never} forwardedUnits={props.units as Units} />
  );
  Component.displayName = "RouterView";
  return Component;
};

export const RouterView = { make: makeRouterView };
export const View = RouterView;

const MatchRenderer = <M extends Router.AnyRouter, Units = void>({
  router,
  views,
  units,
  state,
  index,
}: {
  readonly router: BoundRouter<M>;
  readonly views: RouterViews<M, Units>;
  readonly units: Units;
  readonly state: Router.RouterState<Router.RouterRoutes<M>>;
  readonly index: number;
}): React.ReactNode => {
  const match = state.matches[index] as unknown as Router.RouteMatch | undefined;
  if (match === undefined) return null;
  // The runtime id is erased to `string`; the map itself is keyed strictly.
  // eslint-disable-next-line revizo/no-type-assertion
  const Component = (
    views.routes as Readonly<Record<string, RouteComponent<M, any, Units> | undefined>>
  )[match.route.id];
  const child = (
    <MatchRenderer router={router} views={views} units={units} state={state} index={index + 1} />
  );
  return Component === undefined ? (
    child
  ) : (
    <Component router={router} match={match as never} units={units}>
      {child}
    </Component>
  );
};

type AnchorProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href">;

type LinkState = {
  readonly isActive: boolean;
  readonly isTransitioning: boolean;
};

type StateProps = AnchorProps & { readonly [key: `data-${string}`]: unknown };

export type LinkProps<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
> = AnchorProps &
  Router.NavigateOptions<M, To> & {
    readonly router: BoundRouter<M>;
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
    router,
    activeProps,
    inactiveProps,
    children,
    onClick,
    ...rest
  } = props;

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
  readonly router: BoundRouter<M>;
};

export class Navigate<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
> extends React.PureComponent<NavigateProps<M, To>> {
  componentDidMount(): void {
    this.navigate();
  }

  componentDidUpdate(previous: NavigateProps<M, To>): void {
    if (previous !== this.props) this.navigate();
  }

  private navigate(): void {
    const { router, ...options } = this.props;
    router.navigate(options as never);
  }

  render(): null {
    return null;
  }
}

export type MatchRouteProps<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
> = Router.ToOptions<M, To> &
  Router.ActiveOptions & {
    readonly router: BoundRouter<M>;
    readonly children?:
      | React.ReactNode
      | ((state: { readonly isActive: boolean }) => React.ReactNode);
  };

export function MatchRoute<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  const To extends Router.RoutePath<M> = Router.RoutePath<M>,
>(props: MatchRouteProps<M, To>): React.ReactNode {
  const { router, children, ...rest } = props;
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
    const { router, ...rest } = props;
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
