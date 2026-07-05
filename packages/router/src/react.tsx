import * as React from "react";
import { View as UnitView, type ViewProps } from "@unitflow/react";
import * as Router from "./router.js";

type Controller<M extends Router.AnyRouter> = Router.RouterControllerOf<M>;

export interface BoundRouter<M extends Router.AnyRouter = Router.RegisteredRouter> {
  readonly state: Router.RouterState<Router.RouterRoutes<M>>;
  readonly location: Router.ParsedLocation;
  readonly matches: ReadonlyArray<Router.MatchUnion<M>>;
  readonly api: Controller<M>;
  readonly navigate: (
    options: Router.NavigateOptions<Controller<M>, Router.RoutePath<Controller<M>>>,
  ) => void;
  readonly preload: (
    options: Router.ToOptions<Controller<M>, Router.RoutePath<Controller<M>>>,
  ) => void;
  readonly invalidate: () => void;
}

export type RouteComponent<
  M extends Router.AnyRouter = Router.RegisteredRouter,
  Match extends Router.RouteMatch = Router.MatchUnion<M>,
> = (props: {
  readonly router: BoundRouter<M>;
  readonly match: Match;
  readonly children: React.ReactNode;
}) => React.ReactNode;

type BoundaryComponent<M extends Router.AnyRouter = Router.RegisteredRouter> = (props: {
  readonly router: BoundRouter<M>;
  readonly match?: Router.RouteMatch;
  readonly error?: unknown;
  readonly children?: React.ReactNode;
}) => React.ReactNode;

export interface MatchesProps<M extends Router.AnyRouter = Router.RegisteredRouter> {
  readonly router: BoundRouter<M>;
}

export function Matches<M extends Router.AnyRouter = Router.RegisteredRouter>({
  router,
}: MatchesProps<M>): React.ReactNode {
  const state = router.state as Router.RouterState<Router.RouterRoutes<M>>;
  if (state.status === "error") return renderError(router, state);
  if (state.status === "not-found") return renderNotFound(router, state);
  if (state.status === "pending" && state.matches.length === 0) return renderPending(router);
  return <MatchRenderer router={router} state={state} index={0} />;
}

const makeRouterView = <M extends Router.AnyRouter>(
  router: M,
): React.FC<ViewProps<M>> =>
  UnitView.make(
    router as never,
    (bound) => <Matches router={bound as BoundRouter<M>} />,
  ) as React.FC<ViewProps<M>>;

export const RouterView = { make: makeRouterView };
export const View = RouterView;

const MatchRenderer = <M extends Router.AnyRouter>({
  router,
  state,
  index,
}: {
  readonly router: BoundRouter<M>;
  readonly state: Router.RouterState<Router.RouterRoutes<M>>;
  readonly index: number;
}): React.ReactNode => {
  const match = state.matches[index] as unknown as Router.RouteMatch | undefined;
  if (match === undefined) return null;
  const Component = match.route.options.component as RouteComponent<M, any> | undefined;
  const child = <MatchRenderer router={router} state={state} index={index + 1} />;
  return Component === undefined ? child : <Component router={router} match={match as never}>{child}</Component>;
};

const renderPending = <M extends Router.AnyRouter>(router: BoundRouter<M>): React.ReactNode => {
  const Component = router.api.options.defaultPendingComponent as BoundaryComponent<M> | undefined;
  return Component === undefined ? null : <Component router={router} />;
};

const renderError = <M extends Router.AnyRouter>(
  router: BoundRouter<M>,
  state: Router.RouterState<Router.RouterRoutes<M>>,
): React.ReactNode => {
  const match = state.matches.at(-1) as unknown as Router.RouteMatch | undefined;
  const Component = (match?.route.options.errorComponent ??
    router.api.options.defaultErrorComponent) as BoundaryComponent<M> | undefined;
  if (Component === undefined) return null;
  return match === undefined
    ? <Component router={router} error={state.error} />
    : <Component router={router} match={match} error={state.error} />;
};

const renderNotFound = <M extends Router.AnyRouter>(
  router: BoundRouter<M>,
  state: Router.RouterState<Router.RouterRoutes<M>>,
): React.ReactNode => {
  const match = state.matches.at(-1) as unknown as Router.RouteMatch | undefined;
  const Component = (match?.route.options.notFoundComponent ??
    router.api.options.defaultNotFoundComponent) as BoundaryComponent<M> | undefined;
  if (Component === undefined) return null;
  return match === undefined
    ? <Component router={router} error={state.error} />
    : <Component router={router} match={match} error={state.error} />;
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
    readonly preload?: false | "intent" | "viewport" | "render" | true;
    readonly preloadDelay?: number;
  };

export type LinkComponent = <
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
>(
  props: LinkProps<M, To> & { readonly ref?: React.Ref<HTMLAnchorElement> },
) => React.ReactElement;

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps<any, any>>(function Link(props, ref) {
  const {
    router,
    activeProps,
    inactiveProps,
    preload,
    preloadDelay,
    children,
    onClick,
    onFocus,
    onMouseEnter,
    onTouchStart,
    ...rest
  } = props;

  const href = router.api.buildHref(rest as never);
  const isActive = router.api.matchRoute(rest as never);
  const stateProps = resolveStateProps(isActive ? activeProps : inactiveProps);
  const preloadMode = preload === true ? "intent" : preload ?? router.api.options.defaultPreload;
  const delay = preloadDelay ?? 50;

  const runPreload = (): void => {
    if (preloadMode === false || preloadMode === undefined) return;
    const timeout = preloadMode === "intent" ? delay : 0;
    globalThis.setTimeout(() => {
      router.preload(rest as never);
    }, timeout);
  };

  const handleIntent = <E extends React.SyntheticEvent<HTMLAnchorElement>,>(
    handler: ((event: E) => void) | undefined,
  ) => (event: E): void => {
    handler?.(event);
    if (!event.defaultPrevented && preloadMode === "intent") runPreload();
  };

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
      onFocus={handleIntent(onFocus)}
      onMouseEnter={handleIntent(onMouseEnter)}
      onTouchStart={handleIntent(onTouchStart)}
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
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
>(props: MatchRouteProps<M, To>): React.ReactNode {
  const { router, children, ...rest } = props;
  const isActive = router.api.matchRoute(rest as never);
  if (typeof children === "function") return children({ isActive });
  return isActive ? children : null;
}

export type CreatedLinkComponent = <
  M extends Router.AnyRouter = Router.RegisteredRouter,
  To extends Router.RoutePath<M> = Router.RoutePath<M>,
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
