# Router

`@unitflow/router` is a model-first typed router. Routes declare paths and
codecs only; `Router.make` returns two models the app names by
destructuring:

```ts
export const { NavigationModel, RouteModel } = Router.make("app", allRoutes);
declare module "@unitflow/router" {
  interface Register { readonly router: typeof NavigationModel }
}
```

- `NavigationModel` — the engine: `inputs.navigate` (event),
  `outputs.state`/`location`, `buildHref`/`buildLocation` on the value.
- `RouteModel` — keyed by route id: `Model.get(RouteModel, "user")` returns
  that route's unit with `opened`/`params`/`search`/`provided` as Option
  ports narrowed to the route's schemas.

Path params, search params, and even whole objects in the query string
(`Schema.fromJsonString`) decode through the route's schemas; invalid URLs
land in an error state. Page data has no loaders: a page model gates a
`Query` on the route unit's ports.

React connects in one place — `RouterView.make(NavigationModel, { routes })`
where an entry is either a plain view function (layouts, receives narrowed
`match` and `children`) or a `View.make` component (the router leases its
model and passes the unit). The returned component carries its root model
(`AppView.model`).

Middleware guards are Context-service tags attached per group
(`group.middleware(AuthGuard)`); implementations live in their own layer so
guard dependencies never leak into the router's type. Guards run before a
navigation commits (a blocked URL never flashes), redirect with
`Router.RedirectError`, and their typed return value surfaces as the
`provided` port on guarded route units.

History is a layer capability: `browserHistoryLayer`, `hashHistoryLayer`,
or `memoryHistoryLayer({ initialEntries })` in tests.

Site pages: `src/content/docs/router/*.md`. Every code block is a segment
of `examples/ts/router-docs-check/src/*` — a private package whose build
typechecks the snippets, wired into `examples:build`.
