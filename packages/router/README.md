# @unitflow/router

Effect-native, model-first typed router for Unitflow. Routes declare paths,
codecs, hierarchy, and middleware contracts; implementations and components
stay in models and layers. React meets the router in exactly one place.

## Install

```sh
pnpm add @unitflow/router @unitflow/react @unitflow/core effect@4.0.0-beta.88
```

## `Router.make`: building the router

`Router.make(id, table)` takes a router id and a table of routes (built from
`Route.make`/`Route.group`, below) and returns one `AppRouter`:

```ts
import * as Schema from "effect/Schema";
import { Route, Router } from "@unitflow/router";

const HomeRoute = Route.make("home", { path: "/" });
interface User {
  readonly id: number;
  readonly name: string;
}
class UserLoader extends Router.Middleware<UserLoader>()("app/UserLoader")<{
  readonly user: User;
}>() {}
const UserRoute = Route.make("user", {
  path: "/users/:id",
  params: Schema.Struct({ id: Schema.NumberFromString }),
}).pipe(Route.middleware(UserLoader));

export const AppRouter = Router.make("app/router", Route.group(HomeRoute, UserRoute));

// Registers the router's route table as the default for every typed target
// in the app — Link props, navigate, redirects — a typo won't compile.
declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof AppRouter.model;
  }
}
```

This ambient registration is optional — `RouterView.bindComponents` (below)
is the structural alternative, no `declare module` needed.

- `AppRouter.model` — the navigation engine: `inputs.navigate` (an event),
  `outputs.state`/`location`, `buildHref`/`buildLocation`.
- `AppRouter.routeModel` — keyed by route id: `Model.get(AppRouter.routeModel, "user")`
  returns that route's unit — `outputs.opened`/`params`/`search`/`provided`,
  narrowed to **that route's** schemas. This is mainly for long-lived
  observers outside a matched page; route pages should normally consume
  middleware output as their keyed-model construction value.
- `AppRouter.layer` — the two models' layers, already merged. Still needs a
  history layer (`Router.browserHistoryLayer`, or `memoryHistoryLayer` in
  tests) and any page models' own layers.

## `Route.addChild`: one route owns another's content

A route becomes another's ancestor only if you say so — a route at `/` is
NOT automatically the parent of every other route just because their paths
all start with `/`. `Route.addChild(child)` attaches `child` under `self`;
`child`'s `path` is relative to `self`'s own path, joined on attach:

```ts
const EditRoute = Route.make("edit", { path: "/edit" });

const ProjectRoute = Route.make("project", {
  path: "/projects/:projectId",
  params: Schema.Struct({ projectId: Schema.NumberFromString }),
}).pipe(Route.addChild(EditRoute));
// EditRoute's table path ends up "/projects/:projectId/edit".
```

Use this when one route genuinely owns a child's content — a project page
and its edit sub-view, a list and its detail row.

## `Route.group`: collecting routes into a table

`Route.group(...routes)` collects routes (and, transitively, anything
attached via `addChild`) into the table `Router.make` consumes:

```ts
const allRoutes = Route.group(HomeRoute, UserRoute, ProjectRoute);
```

Two routes with a shared literal path prefix that were never `addChild`-linked
simply don't nest — the group is flat unless the hierarchy says otherwise.

## `Route.middleware`: guards and loaders as services

`middleware` attaches a Context-service tag to every route currently in a
group. It runs **before** navigation commits, so it can guard access or load
one-shot route data. A failure prevents the URL from reaching history/state;
its success value (`Provides`) becomes the route's typed `Route.Output`:

```ts
class AuthGuard extends Router.Middleware<AuthGuard>()("app/AuthGuard")<{
  readonly user: string;
}>() {}

const AuthGuardLive = AuthGuard.layer(() =>
  Effect.gen(function* () {
    const session = yield* SessionService; // the GUARD's dependency, not the router's
    const user = yield* session.currentUser;
    if (Option.isNone(user)) {
      return yield* Effect.fail(new Router.RedirectError({ options: { to: "/login" } }));
    }
    return { user: user.value };
  }),
);

const adminRoutes = Route.group(ProjectRoute).middleware(AuthGuard);
```

Attaching to a route with declared children (`addChild`/`layout`) guards the
whole branch — the router walks the explicit ancestor chain, so the guard
runs once per navigation into that route or any descendant, never for an
unrelated route that merely shares a path prefix.

## `Route.layout`: a shared shell for independent siblings

`Route.layout(id)` covers the OTHER nesting shape: wrapping routes that
aren't each other's content — just independent pages sharing one rendering
or guard scope — under a shared, pathless parent that contributes no URL
segment of its own:

```ts
const SettingsRoute = Route.make("settings", { path: "/settings" });
const ReportsRoute = Route.make("reports", { path: "/reports" });

const dashboard = Route.group(SettingsRoute, ReportsRoute).pipe(Route.layout("dashboard"));
```

`addChild` is for one route that owns a child's content; `layout` is for a
shell around otherwise-unrelated resources.

## A few smaller combinators

- `Route.prefix(path)` — re-roots every route in a group under `path`:
  `Route.group(SettingsRoute, ReportsRoute).pipe(Route.prefix("/admin"))`.
- `.merge(...)` — combines groups: `publicRoutes.merge(adminRoutes)`.
- `.add(...)` — appends routes to a group directly.
- `Route.search`/`Route.schemaSearch` — build a `search` codec from a plain
  Schema.Struct or a hand-written encode/decode pair, for query strings a
  Struct alone can't express.

## `RouterView.make`: connecting to React

React meets the router in exactly one place: `RouterView.make` takes
`AppRouter.model` and a map from route ids to views.

```tsx
import { View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";

// UserPageModel is keyed by Route.Output<typeof UserRoute>; the third
// argument makes the View self-leasing, so middleware output is its key.
const UserPage = View.make(UserPageModel, ({ user }) => /* JSX */, {});

export const AppView = RouterView.make(AppRouter.model, {
  routes: {
    home: ({ children }) => (
      <main>
        <nav>
          <Link to="/users/:id" params={{ id: 1 }}>Ada</Link>
        </nav>
        {children}
      </main>
    ),
    user: UserPage, // middleware succeeds → model lease starts → view renders
  },
  notFound: () => <div>404</div>,
});
```

A route with declared children nests its view the same way its declaration
does — `{ view, routes: { ... } }`, keyed like the route table:

```tsx
routes: {
  project: { view: ProjectPage, routes: { edit: ProjectEditView } },
},
```

`ProjectPage` receives `ProjectEditView`'s rendered output as `children`
only while `/projects/:id/edit` is actually matched.

Mount by rooting the tree with `AppView.model` — it owns the navigation
model and every page model stitched into the map:

```tsx
const layer = AppView.model.layer.pipe(
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(AppRouter.layer),
  Layer.provideMerge(Router.browserHistoryLayer), // or memoryHistoryLayer in tests
);

<Unitflow runtime={UnitflowRuntime.make(layer)} rootModel={AppView.model}>
  {(pages) => <AppView unit={pages} />}
</Unitflow>;
```

`Link`/`Navigate`/`MatchRoute` pick up their bound router from React context
at runtime, which TypeScript can't see through — `to`/`params`/`search`
typing needs some static source. The `declare module { Register }` above is
one option (ambient, app-wide, zero imports). `RouterView.bindComponents`
is the structural alternative — same components, re-typed to a router you
pass in explicitly, no ambient state, works with more than one router:

```tsx
export const { Link, Navigate, MatchRoute } = RouterView.bindComponents(AppRouter.model);
```

Import these from your routes module instead of `@unitflow/router/react`'s.

## Full docs

- [Routes and Schemas](https://github.com/timurrakhimzhan/unitflow/blob/main/src/content/docs/router/routes.md) —
  path/search params, groups, nesting with `Route.addChild`/`Route.layout`.
- [The AppRouter Models](https://github.com/timurrakhimzhan/unitflow/blob/main/src/content/docs/router/models.md) —
  middleware-fed keyed page models, route observers, navigation, and history.
- [React](https://github.com/timurrakhimzhan/unitflow/blob/main/src/content/docs/router/react.md) —
  the views map, nesting it to mirror the route table, mounting.
- [Middleware](https://github.com/timurrakhimzhan/unitflow/blob/main/src/content/docs/router/middleware.md) —
  guards as Context services, redirects, typed `Provides`.

Or the runnable examples:
[`router-basic`](https://github.com/timurrakhimzhan/unitflow/tree/main/examples/ts/router-basic),
[`router-guard`](https://github.com/timurrakhimzhan/unitflow/tree/main/examples/ts/router-guard).
