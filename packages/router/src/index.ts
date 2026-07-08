export * as Router from "./public.js";
export * as RouterGroup from "./router-group.js";

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
