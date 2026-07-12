# Router

`@unitflow/router` is a model-first typed router. Routes declare paths,
codecs, hierarchy, and middleware contracts; `Router.make` returns one
`AppRouter`:

```ts
export const AppRouter = Router.make("app", allRoutes);
declare module "@unitflow/router" {
  interface Register { readonly router: typeof AppRouter.model }
}
```

- `AppRouter.model` — the engine: `inputs.navigate` (event),
  `outputs.state`/`location`, `buildHref`/`buildLocation` on the value.
- `AppRouter.routeModel` — keyed by route id: `Model.get(AppRouter.routeModel, "user")` returns
  that route's unit with `opened`/`params`/`search`/`provided` as Option
  ports narrowed to the route's schemas.
- `AppRouter.layer` — both models composed; the app supplies history,
  middleware implementations, and page-model layers.

Path params, search params, and even whole objects in the query string
(`Schema.fromJsonString`) decode through the route's schemas; invalid URLs
land in an error state. Middleware runs before commit and returns typed
`Provides`; a page model keyed by `Route.Output<typeof Route>` receives that
data on the first line of `make`, without optional route-port gating.

React connects in one place — `RouterView.make(AppRouter.model, { routes })`
where an entry is either a plain view function (layouts, receives narrowed
`match` and `children`) or a `View.make` component. A self-leasing
`View.make(PageModel, render, {})` receives middleware output as its keyed
model construction value. The returned component carries its root model.

Middleware are Context-service tags attached per route or group. Their
implementations live in layers, so guard/loader dependencies never leak into
the router's type. They can redirect, return not-found, or load one-shot page
data before navigation commits; their merged return value is the route's
`Route.Output`.

History is a layer capability: `browserHistoryLayer`, `hashHistoryLayer`,
or `memoryHistoryLayer({ initialEntries })` in tests.

Site pages: `src/content/docs/router/*.md`. Every code block is a segment
of `examples/ts/router-docs-check/src/*` — a private package whose build
typechecks the snippets, wired into `examples:build`.
