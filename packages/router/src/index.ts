export * as Router from "./public.js";
export * as Route from "./route.js";
// Direct type re-exports: through a bare `export * as` alone, the
// declaration emitter cannot name the symbols flowing through in a
// composite/declaration consumer build (TS2742/TS2883) — it falls back to
// the private `dist/router.d.ts` path, which the package's `exports` map
// does not expose. Named from `./public.js` (not `./router.js`) so the
// curated boundary holds: only the intentionally public types become
// nameable.
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
