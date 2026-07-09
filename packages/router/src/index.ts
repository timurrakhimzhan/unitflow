export * as Router from "./public.js";
export * as Route from "./route.js";
// Direct type re-exports: through a bare `export * as` alone, the
// declaration emitter cannot name the symbols flowing through in a
// composite/declaration consumer build (TS2742/TS2883) — it falls back to
// the private `dist/router.d.ts` path, which the package's `exports` map
// does not expose. `Route`'s own namespace re-export needs this same
// treatment `Router`'s already had, and missed it when `Route` was split
// out (router 0.2.0 shipped with this gap: `Route.layout`'s return type
// leaked an unexported helper, TS2742, in any composite consumer).
//
// Curated, not a blanket `export type * from "./route.js"`: that pulls in
// `make` (`Route.make`'s type) too, which collides with `./public.js`'s own
// `make` (`Router.make`), and `Route`/`RouteGroup`/etc., which collide with
// the `export * as Route` namespace binding right above. `./public.js`
// already re-exports those (it always has); only the internal helper types
// new to the `Route` namespace's combinators need adding here.
export type * from "./public.js";
export type {
  WithChild,
  PrefixedTuple,
  PrefixedRoute,
  WithMiddleware,
  MembersOf,
} from "./route.js";

/**
 * Registration point for the app's router. Declared HERE — in the package
 * entry — because module augmentation only merges with an interface declared
 * in the augmented module itself; a re-export would silently not merge.
 *
 * ```ts
 * declare module "@unitflow/router" {
 *   interface Register {
 *     readonly router: typeof AppRouter;
 *   }
 * }
 * ```
 */
export interface Register {}
