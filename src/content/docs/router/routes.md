---
title: "Router: Routes and Schemas"
description: Declaring routes, typing path params and search params with Schema, composing groups, and creating the router.
---

`@unitflow/router` is a model-first router: routes declare **paths and
codecs** — never components, loaders, or data. Everything else in the app
reads route state through ordinary model ports.

```sh
pnpm add @unitflow/router @unitflow/react @unitflow/core effect@4.0.0-beta.88
```

## Declaring Routes

A route is an id plus options. The id names the route everywhere else — in
the per-route model, in the React views map — so ids must be unique per
router (a duplicate is a construction-time error).

```ts
import * as Schema from "effect/Schema";
import { Route } from "@unitflow/router";

export const HomeRoute = Route.make("home", { path: "/" });
export const LoginRoute = Route.make("login", { path: "/login" });
```

## Path Params

Path segments starting with `:` are params. Without a schema they stay raw
strings, typed from the path literal. With a `params` schema the raw
strings decode into typed values — and encode back when building links.

```ts
const userParams = Schema.Struct({ id: Schema.NumberFromString });

export const UserRoute = Route.make("user", {
  path: "/users/:id",
  params: userParams,
});
// Without a schema, params stay raw strings typed from the path:
export const FileRoute = Route.make("file", { path: "/files/*path" });
export const DraftRoute = Route.make("draft", { path: "/drafts/:id?" });
```

`/users/42` matches `UserRoute` with `params` decoded to `{ id: 42 }` — a
`number`, because `NumberFromString` said so. `*path` captures the rest of
the URL, `:id?` makes a segment optional.

## Search Params

The `search` schema owns the query string. It handles far more than flat
strings: literal unions, optional keys, and whole objects JSON-encoded into
a single param.

```ts
const usersSearch = Schema.Struct({
  // "?page=2" -> 2
  page: Schema.NumberFromString,
  // literal unions reject anything else at compile time AND at runtime
  sort: Schema.Literals(["asc", "desc"]),
  // a whole OBJECT in one query param, JSON-encoded
  filter: Schema.fromJsonString(Schema.Struct({ role: Schema.String })),
  // optional: absent from the URL means absent from the value
  q: Schema.optionalKey(Schema.String),
});

export const UsersRoute = Route.make("users", {
  path: "/users",
  search: usersSearch,
});
```

A URL that fails the schema — `?sort=sideways`, broken JSON in `filter` —
puts the router into an `error` state instead of half-decoding the page.

## Groups

Groups collect routes and compose: `add` appends, `merge` combines groups,
`prefix` re-roots every path. The same shape as `RpcGroup` in Effect.

```ts
const publicRoutes = Route.group(HomeRoute, LoginRoute);
const userRoutes = Route.group(UsersRoute, UserRoute);

// merge and prefix compose groups; ids must stay unique
const allRoutes = publicRoutes
  .merge(userRoutes)
  .merge(Route.group(FileRoute, DraftRoute).prefix("/storage"));
```

## Nesting: `Route.addChild` and `Route.layout`

Nesting is **declared**, never inferred from a shared path prefix. A route
at `/` does not become an ancestor of every other route just because every
path starts with `/` — a route has children only if `Route.addChild` said
so. This matters for two things: which view wraps which
([React](/router/react/)) and which routes a guard attached to a parent
actually covers ([Middleware](/router/middleware/)).

`child`'s `path` is relative to the parent's own path — joined on attach:

```ts
const EditRoute = Route.make("edit", { path: "/edit" });

// ProjectRoute owns EditRoute: /projects/:projectId/edit is its child page,
// not an unrelated route that happens to share a path prefix.
export const ProjectRoute = Route.make("project", {
  path: "/projects/:projectId",
  params: Schema.Struct({ projectId: Schema.NumberFromString }),
}).pipe(Route.addChild(EditRoute));
```

`Route.layout(id)` covers the other shape: wrapping *independent* siblings
— routes that aren't each other's content, just share a rendering/guard
scope — under a shared, pathless parent that contributes no URL segment of
its own:

```ts
// Route.layout wraps otherwise-unrelated siblings under a shared, pathless
// parent — for a shell around resources that aren't nested in each other.
const SettingsRoute = Route.make("settings", { path: "/settings" });
const ReportsRoute = Route.make("reports", { path: "/reports" });
const dashboardArea = Route.group(SettingsRoute, ReportsRoute).pipe(Route.layout("dashboard"));
```

Use `addChild` when one route genuinely owns a child's content (a project
page and its edit sub-view); use `layout` when several routes merely share a
wrapper (a dashboard shell around otherwise-unrelated resources).

## Creating the Router

`Router.make` births one `AppRouter`: `model` (the engine), `routeModel`
(the keyed per-route model), and `layer` (the two, already composed).
Registering the router afterwards makes every erased target — `Link` props,
redirect options — typecheck against this exact route table.

```ts
export const AppRouter = Router.make(
  "docs/router",
  allRoutes.merge(Route.group(ProjectRoute)).merge(dashboardArea),
);

// Registering the router types Link/redirect targets application-wide.
declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof AppRouter.model;
  }
}
```

What `model` and `routeModel` are — and how pages consume them — is the
subject of [the next section](/router/models/).
