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
