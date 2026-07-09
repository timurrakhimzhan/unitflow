/**
 * The `Route` namespace: everything for declaring and composing routes —
 * `Route.make` (was `Router.route`), `Route.group` (was `Router.group`),
 * plus the pipeable combinators (`addChild`, `layout`, `middleware`,
 * `prefix`) that build up a route's hierarchy and cross-cutting concerns.
 * `Router` (see `public.ts`) keeps only what's genuinely about the whole
 * app-level router: `Router.make` (the `AppRouter` constructor),
 * `Router.Middleware`, `Router.RedirectError`/`NotFoundError`, and the
 * history layers.
 */
export {
  type AnyRouteGroup,
  type Route,
  type RouteGroup,
  type AnySearchCodec,
  type SearchCodec,
  // Internal machinery, not meant to be named directly in application code
  // — exported ONLY so a downstream composite/declaration build can print
  // them when they surface inside `addChild`/`layout`/`prefix`/`middleware`'s
  // return types (an unexported type referenced from an exported signature
  // is a hard TS2742/TS2883 error, not just an inconvenience — see index.ts).
  type WithChild,
  type PrefixedTuple,
  type PrefixedRoute,
  type WithMiddleware,
  type MembersOf,
  addChild,
  route as make,
  add,
  group,
  isRoute,
  layout,
  merge,
  middleware,
  prefix,
  routes,
  schemaSearch,
  search,
} from "./router.js";
