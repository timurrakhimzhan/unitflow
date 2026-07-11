---
title: "Router: Middleware"
description: Guards as Context services — blocking navigation before it commits, redirecting, and providing typed data to guarded routes.
---

Middleware guards navigation. A guard runs for every matched route it is
attached to **before the navigation commits**: a blocked URL never reaches
history or state, not even for a frame.

Two design decisions matter here:

- a guard is a **Context service (a tag)**, not a function. The router only
  ever requires the tag; the implementation — and its dependencies — live
  in a layer composed at the feature level. Guard dependencies never leak
  into the router's type.
- a guard's success value is its **Provides**: it lands, fully typed, in
  the guarded route's unit.

## Declaring a Guard

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Model, Store } from "@unitflow/core";
import { Route, Router } from "@unitflow/router";

interface SessionShape {
  readonly currentUser: Effect.Effect<Option.Option<string>>;
}
export class SessionService extends Context.Service<SessionService, SessionShape>()(
  "docs/Session",
) {}

/** The guard is a TAG. `<{ user: string }>` declares what it PROVIDES. */
export class AuthGuard extends Router.Middleware<AuthGuard>()("docs/AuthGuard")<{
  readonly user: string;
}>() {}
```

## Implementing It

`layer` builds the implementation layer. `MiddlewareHandler` has no
requirements channel — a guard reading live state (`Store.get`, `Model.get`)
needs services on every call, not just once — so `layer` resolves the
handler's own services once at layer build and captures them, keeping the
stored handler dependency-free while it still runs fresh Effect code per
call. Failing with `RedirectError` (or `NotFoundError`) cancels the
navigation.

```ts
export const AuthGuardLive = AuthGuard.layer((context) =>
  Effect.gen(function* () {
    const session = yield* SessionService; // the GUARD's dependency, not the router's
    const user = yield* session.currentUser;
    if (Option.isNone(user)) {
      // typed against the registered router; cancels the navigation BEFORE
      // it commits — the blocked URL never flashes
      return yield* Effect.fail(new Router.RedirectError({ options: { to: "/login" } }));
    }
    void context; // params/search/location of the matched route
    return { user: user.value }; // Provides
  }),
);
```

For a guard with no per-call reactive reads, a plain `Layer.effect(Tag, ...)`
works too — `layer` only earns its keep once the handler needs to see fresh
state on every navigation, not just what was true when the layer built.

Redirects also fire on the **initial load** and on browser back/forward: a
direct deep link into a guarded URL lands on the redirect target, never on
the guarded page.

## Attaching to Routes

`middleware` attaches the tag to every route currently in a group — the
same composition shape as `add`/`merge`/`prefix`. Attaching it to a route
with declared children (via [`Route.addChild`/`Route.layout`](/router/routes/#nesting-routeaddchild-and-routelayout))
guards the whole branch: `resolveMatches` walks the explicit ancestor chain,
so the guard runs once per navigation into that route OR any of its
descendants — group-wide `middleware` is only needed for independent routes
with no shared parent.

```ts
const DashboardRoute = Route.make("dashboard", { path: "/dashboard" });
const MembersRoute = Route.make("members", { path: "/members" });

const adminRoutes = Route.group(DashboardRoute, MembersRoute)
  .middleware(AuthGuard)
  .prefix("/admin");

export const AdminRouter = Router.make(
  "docs/admin-router",
  Route.group(Route.make("home", { path: "/" })).merge(adminRoutes),
);
```

Forget `AuthGuardLive` in the layer composition and `AdminRouter.layer` does
not typecheck — a missing guard is a compile error, not a runtime surprise.

## Running Guards Concurrently

Several guards on one route run sequentially by default. When they're
independent of each other — a session check and an unrelated preload, say —
`Route.middlewaresConcurrency` lets them run in parallel instead:

```ts
const DashboardRoute = Route.make("dashboard", { path: "/dashboard" }).pipe(
  Route.middleware(AuthGuard),
  Route.middleware(PreloadDashboardData),
  Route.middlewaresConcurrency("unbounded"),
);
```

Also available on a group, applying to every route in it independently:

```ts
const adminRoutes = Route.group(DashboardRoute, MembersRoute)
  .middleware(AuthGuard)
  .middlewaresConcurrency("unbounded");
```

This only affects guards attached to the SAME route (or group) — guards
across different levels of a nested route (a parent's vs. a child's) still
always run parent-first, in order, so a parent's redirect still cancels the
navigation before any child guard runs.

## Reading the Provides

The guard's return value lands in the guarded route's unit as the
`provided` port. The guarantee is constructive: the route can only be open
because the guard passed, so `provided` is `Option.some` whenever `opened`
is `true`.

```ts
const readProvided = Effect.gen(function* () {
  const unit = yield* Model.get(AdminRouter.routeModel, "dashboard");
  const provided = yield* Store.get(unit.outputs.provided);
  // Option.some({ user }) whenever the route is open: the guard passing is
  // what LET it open
  if (Option.isSome(provided)) {
    const user: string = provided.value.user;
    void user;
  }
});
```

Several guards on one route merge their Provides (`P1 & P2`). Inside a view
map, the same data is available as `match.provided` on the guarded route's
match.

## Getting Provides Into a Page Model

Reading `unit.outputs.provided` from inside a page model works, but it
duplicates the `Option.isSome` check the guard already did — the model
can't be open unless the guard already passed. It also only ever settles
AFTER the model already exists — no good for data a page model needs on the
very first line of its own `make`, like a Query dependency.

Key the page model by its route's own `Route.Output` instead, and pair it
with [`routeView`](/router/react/) — the model is leased lazily, exactly
when the route first matches, with the guard's Provides as the construction
argument:

```ts
import { routeView } from "@unitflow/router/react";

// Keyed by the route's own Output — `user` arrives on the very first line
// of make(): no placeholder, no Option. The model isn't constructed AT ALL
// until the guard has already provided it, so there's nothing to wire.
export class DashboardPageModel extends Model.Service<DashboardPageModel>()(
  "docs/DashboardPage",
)<{ readonly user: string }>()({
  make: ({ user }) =>
    Effect.gen(function* () {
      const greeting = Store.make(`Hello, ${user}`);
      return { inputs: {}, outputs: {}, ui: { greeting } };
    }),
}) {}

export const DashboardView = routeView(DashboardPageModel, ({ greeting }) => greeting);
```

The key must match the route's `Route.Output` exactly — a model keyed by
the wrong type, wired into the wrong route id, fails to compile at the
`RouterView.make({ routes: {...} })` call site, the same way a mismatched
`inputs` field used to. This is also how a future loader would plug in: as
a middleware that provides the fetched data, arriving as the model's key.
