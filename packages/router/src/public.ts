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
  // stitches page models to a router's routes — see `PageMap`
  makePages,
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
  // Internal machinery, not meant to be named directly in application code
  // — exported ONLY so a downstream composite/declaration build can print
  // them when they surface inside `addChild`/`layout`/`prefix`/`middleware`'s
  // return types (an unexported type referenced from an exported signature
  // is a hard TS2742/TS2883 error — see `RoutesOf` above, the same
  // treatment `index.ts`'s `export type *` needs a REAL export to forward).
  WithChild,
  PrefixedTuple,
  PrefixedRoute,
  WithMiddleware,
  MembersOf,
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
