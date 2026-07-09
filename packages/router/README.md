# @unitflow/router

Effect-native, model-first typed router for Unitflow.

Routes declare paths and codecs — never components, loaders, or data.
`Router.make` births one `AppRouter`: `model` (the engine — navigation,
current location), `routeModel` (a keyed per-route model: occupancy and
decoded params/search), and `layer` (the two, already composed). Page data
lives in ordinary Unitflow models gated on route ports; React meets the
router in exactly one place.

## Install

```sh
pnpm add @unitflow/router @unitflow/react @unitflow/core effect@4.0.0-beta.88
```

## Routes and models

```ts
import * as Schema from "effect/Schema";
import { Route, Router } from "@unitflow/router";

const userParams = Schema.Struct({ id: Schema.NumberFromString });
const userSearch = Schema.Struct({ page: Schema.NumberFromString });

export const HomeRoute = Route.make("home", { path: "/" });
export const UserRoute = Route.make("user", {
  path: "/users/:id",
  params: userParams,
  search: userSearch,
});

export const AppRouter = Router.make("app/router", Route.group(HomeRoute, UserRoute));

// Registering the router types Link/redirect targets everywhere.
declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof AppRouter.model;
  }
}
```

- `AppRouter.model` — the engine: `inputs.navigate` (an event, like any
  model input), `outputs.state`/`location`, `buildHref`/`buildLocation`.
- `AppRouter.routeModel` — keyed by route id:
  `Model.get(AppRouter.routeModel, "user")` returns that route's unit with
  `outputs.opened`/`params`/`search`/`provided` as `Option` ports, narrowed
  to THAT route's schemas.
- `AppRouter.layer` — `routeModel.layer` and `model.layer`, already merged;
  still requires a history layer (`Router.browserHistoryLayer` or
  `memoryHistoryLayer` in tests), and, for page models reading route ports,
  their own layers.

## Nesting: `Route.addChild`

Nesting is declared, never inferred from a shared path prefix — a route only
becomes an ancestor of another via `Route.addChild`. The child's `path` is
relative to the parent's own path, joined on attach:

```ts
const EditRoute = Route.make("edit", { path: "/edit" });

export const ProjectRoute = Route.make("project", {
  path: "/projects/:projectId",
  params: Schema.Struct({ projectId: Schema.NumberFromString }),
}).pipe(Route.addChild(EditRoute));
// EditRoute's declared table path is "/projects/:projectId/edit".
```

A route with no `addChild` calls has no children — including a route at
`/`: two routes that happen to share a literal path prefix never nest unless
this was called explicitly. `Route.layout(id)` covers the other case —
wrapping *independent* siblings (not one route's own child content) under a
shared, pathless parent that contributes no URL segment of its own:

```ts
const dashboard = Route.group(SettingsRoute, ReportsRoute).pipe(Route.layout("dashboard"));
```

## Page data: a model gated on route ports

```ts
class UserPageModel extends Model.Service<UserPageModel>()("app/UserPage")({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(AppRouter.routeModel, "user");
      const user = yield* Query.make({
        stores: { params: unit.outputs.params },
        handler: ({ params }) =>
          Option.isNone(params)
            ? Effect.fail("closed" as const)
            : fetchUser(params.value.id), // id: number — decoded by the schema
      });
      return { inputs: {}, outputs: {}, ui: { user: user.state } };
    }),
}) {}
```

Entering `/users/1` loads; changing the id reloads; leaving fails the query
into `"closed"`. No loader, no cache options — the model owns its data.

## React: one meeting point

```tsx
import { Link, RouterView } from "@unitflow/router/react";

const UserPage = View.make(UserPageModel, ({ user }) => /* AsyncResult → JSX */);

export const AppView = RouterView.make(AppRouter.model, {
  routes: {
    home: ({ children }) => (
      <main>
        <nav>
          {/* to/params/search typed against the registered router */}
          <Link to="/users/:id" params={{ id: 1 }} search={{ page: 1 }}>Ada</Link>
        </nav>
        {children}
      </main>
    ),
    user: UserPage, // a View.make component IS its own entry
  },
  notFound: () => <div>404</div>,
});

// main.tsx — the view carries its root model
const layer = AppView.model.layer.pipe(
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(AppRouter.layer),
  Layer.provideMerge(Router.browserHistoryLayer), // or memoryHistoryLayer in tests
);

<Unitflow runtime={UnitflowRuntime.make(layer)} rootModel={AppView.model}>
  {(pages) => <AppView unit={pages} />}
</Unitflow>;
```

A route with declared children (via `Route.addChild`/`Route.layout`) nests
its view the same way in the map — `{ view, routes: { ... } }` — mirroring
the route table instead of being inferred separately:

```tsx
routes: {
  project: { view: ProjectPage, routes: { edit: ProjectEditView } },
},
```

`ProjectPage` receives `ProjectEditView`'s rendered output as `children`
only while `/projects/:id/edit` is actually matched — `null` otherwise, so
`children ?? <ProjectOverview />` picks between the two. Give the edit view
its own model that leases `ProjectPageModel` (`Model.get`, a shared
singleton) for data already loaded by the parent, rather than routing logic
living inside either model — the two stay sibling page models, and the
nesting is purely a rendering/URL concern.

## Middleware: guards as services

```ts
class AuthGuard extends Router.Middleware<AuthGuard>()("app/AuthGuard")<{
  readonly user: User;
}>() {}

const AuthGuardLive = AuthGuard.layer((ctx) =>
  Effect.gen(function* () {
    const session = yield* SessionService; // the GUARD's dependency, not the router's
    if (Option.isNone(session.user)) {
      return yield* Effect.fail(new Router.RedirectError({ options: { to: "/login" } }));
    }
    return { user: session.user.value }; // Provides
  }),
);

const adminRoutes = Route.group(Dashboard, Users).middleware(AuthGuard);
```

Guards run BEFORE a navigation commits: a blocked URL never flashes. The
returned value lands typed in the route unit's `provided` port —
`Option.some` whenever the route is open, because the guard passing is what
let it open. Attaching a guard to a route with declared children guards the
whole branch: `resolveMatches` walks the explicit ancestor chain, so the
guard runs once per navigation into that route OR any of its descendants —
never for an unrelated route that merely shares a path prefix.

## Complex search params

Schemas own the URL: literal unions, optional keys, and whole objects
(JSON-encoded into one param) decode into typed ports and encode back
through `Link`/`navigate`/`buildHref`.

```ts
const search = Schema.Struct({
  sort: Schema.Literals(["asc", "desc"]),
  filter: Schema.fromJsonString(Schema.Struct({ role: Schema.String })),
  q: Schema.optionalKey(Schema.String),
});
```

## History is a capability

`Router.make` declares routes only; the environment decides how locations
are read and written: `Router.browserHistoryLayer`,
`Router.hashHistoryLayer`, or `Router.memoryHistoryLayer({ initialEntries })`
in tests. Forgetting one is a compile error, not a silent default.
