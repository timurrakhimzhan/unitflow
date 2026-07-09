/**
 * The curated public surface re-exported as the `Router` namespace: only
 * what's genuinely about the whole app-level router. Route declaration and
 * composition (`Route.make`, `Route.group`, `Route.addChild`, ...) lives
 * under the `Route` namespace instead (`route.ts`) — a route is its own
 * primitive, the same standing as a `Query` or a `Store`, not a verb inside
 * `Router`. EXCEPT the controller plumbing
 * (`RouterController`/`AnyRouterController`/`RouterControllerOf`): that is
 * the synchronous read surface behind `outputs.api` — `react.tsx` and the
 * `buildLocation`/`buildHref`/`matchRoute` helpers use it internally, but
 * application code should never need to name it.
 */
export {
  // redirect / not-found
  RedirectError,
  NotFoundError,
  isRedirectError,
  isNotFoundError,
  // middleware
  Middleware,
  // the AppRouter constructor
  make,
  // histories — provided as layers; the create* factories stay exported for
  // custom History implementations
  History,
  browserHistoryLayer,
  hashHistoryLayer,
  memoryHistoryLayer,
  createMemoryHistory,
  createBrowserHistory,
  createHashHistory,
  defaultParseSearch,
  defaultStringifySearch,
} from "./router.js";

export type {
  SearchPrimitive,
  SearchValue,
  RawSearch,
  SearchRecord,
  PathParams,
  JoinPath,
  SearchCodec,
  AnySearchCodec,
  AnySchemaCodec,
  RouteContext,
  RouteOptions,
  Route,
  MiddlewareContext,
  MiddlewareHandler,
  MiddlewareClass,
  AnyMiddleware,
  ProvidesOf,
  RouteGroup,
  AnyRouteGroup,
  RoutesOf,
  ParsedLocation,
  RouterHistory,
  HistoryFactory,
  RouteMatch,
  RouterState,
  RouterOptions,
  ActiveOptions,
  Blocker,
  NavigatePayload,
  RouterShape,
  RouterModel,
  RouterTargets,
  RouteModel,
  PagesModel,
  AnyPagesModel,
  PagesShape,
  PageMap,
  RouteUnitShape,
  RouteShapes,
  RouteIds,
  AnyRouter,
  RegisteredRouter,
  RouterGroupOf,
  RouterIdOf,
  RouterRoutes,
  RoutePath,
  RouteByPath,
  MatchByPath,
  MatchUnion,
  ToOptions,
  RawToOptions,
  NavigateOptions,
  AppRouter,
} from "./router.js";
