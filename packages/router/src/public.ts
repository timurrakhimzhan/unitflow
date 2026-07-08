/**
 * The curated public surface re-exported as the `Router` namespace.
 * Everything from `router.ts` EXCEPT the controller plumbing
 * (`RouterController`/`AnyRouterController`/`RouterControllerOf`): that is
 * the synchronous read surface behind `outputs.api` — `react.tsx` and the
 * `buildLocation`/`buildHref`/`matchRoute` helpers use it internally, but
 * application code should never need to name it.
 */
export {
  // route + group construction
  search,
  schemaSearch,
  isRoute,
  route,
  group,
  makeGroup,
  add,
  merge,
  prefix,
  routes,
  // redirect / not-found
  RedirectError,
  NotFoundError,
  isRedirectError,
  isNotFoundError,
  // middleware
  Middleware,
  // router model
  make,
  // location helpers
  buildLocation,
  buildHref,
  matchRoute,
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
  RoutesModel,
  RouteUnitShape,
  RouteShapes,
  RouteIds,
  AnyRouter,
  RegisteredRouter,
  RouterGroupOf,
  RouterRoutes,
  RoutePath,
  RouteByPath,
  MatchByPath,
  MatchUnion,
  ToOptions,
  NavigateOptions,
} from "./router.js";
