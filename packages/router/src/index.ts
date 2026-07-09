export * as Router from "./public.js";
export * as Route from "./route.js";
// Direct type re-exports: through a bare `export * as` alone, the
// declaration emitter cannot name the symbols flowing through in a
// composite/declaration consumer build (TS2742/TS2883) — it falls back to
// the private `dist/router.d.ts` path, which the package's `exports` map
// does not expose. Named from `./public.js` (not `./router.js`, and not
// `./route.js` — that's not in the `exports` map either) so the curated
// boundary holds AND every type stays reachable through one blessed path:
// `Route`'s own combinators (`addChild`/`layout`/`prefix`/`middleware`)
// route through `public.ts`'s type list too, rather than a SECOND
// `export type *` from `./route.js` here — that would collide with
// `make`/`Route`/`RouteGroup`, which `./route.js` ALSO exports, either
// under the same name for something unrelated (`Route.make` vs
// `Router.make`) or the same thing reached a different way (the
// `export * as Route` namespace binding right above).
export type * from "./public.js";

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
