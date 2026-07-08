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
import { Router } from "@unitflow/router";

export const HomeRoute = Router.route("home", { path: "/" });
export const LoginRoute = Router.route("login", { path: "/login" });
```

## Path Params

Path segments starting with `:` are params. Without a schema they stay raw
strings, typed from the path literal. With a `params` schema the raw
strings decode into typed values — and encode back when building links.

```ts
const userParams = Schema.Struct({ id: Schema.NumberFromString });

export const UserRoute = Router.route("user", {
  path: "/users/:id",
  params: userParams,
});
// Without a schema, params stay raw strings typed from the path:
export const FileRoute = Router.route("file", { path: "/files/*path" });
export const DraftRoute = Router.route("draft", { path: "/drafts/:id?" });
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

export const UsersRoute = Router.route("users", {
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
const publicRoutes = Router.group(HomeRoute, LoginRoute);
const userRoutes = Router.group(UsersRoute, UserRoute);

// merge and prefix compose groups; ids must stay unique
const allRoutes = publicRoutes
  .merge(userRoutes)
  .merge(Router.group(FileRoute, DraftRoute).prefix("/storage"));
```

## Creating the Router

`Router.make` births **two models** at once; the application only names
them through destructuring. Registering the router afterwards makes every
erased target — `Link` props, redirect options — typecheck against this
exact route table.

```ts
export const { NavigationModel, RouteModel } = Router.make("docs/router", allRoutes);

// Registering the router types Link/redirect targets application-wide.
declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof NavigationModel;
  }
}
```

What the two models are — and how pages consume them — is the subject of
[the next section](/router/models/).
