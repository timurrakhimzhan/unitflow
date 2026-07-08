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
import { Router } from "@unitflow/router";

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

`make` builds the implementation layer. The handler's own services are
resolved once at layer build; failing with `RedirectError` (or
`NotFoundError`) cancels the navigation.

```ts
export const AuthGuardLive = AuthGuard.make((context) =>
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

Redirects also fire on the **initial load** and on browser back/forward: a
direct deep link into a guarded URL lands on the redirect target, never on
the guarded page.

## Attaching to Routes

`middleware` attaches the tag to every route currently in a group — the
same composition shape as `add`/`merge`/`prefix`. A guard shared by parent
and child routes in one matched branch runs once per navigation.

```ts
const DashboardRoute = Router.route("dashboard", { path: "/dashboard" });
const MembersRoute = Router.route("members", { path: "/members" });

const adminRoutes = Router.group(DashboardRoute, MembersRoute)
  .middleware(AuthGuard)
  .prefix("/admin");

export const { NavigationModel: AdminNav, RouteModel: AdminRouteModel } = Router.make(
  "docs/admin-router",
  Router.group(Router.route("home", { path: "/" })).merge(adminRoutes),
);
```

Forget `AuthGuardLive` in the layer composition and `AdminNav.layer` does
not typecheck — a missing guard is a compile error, not a runtime surprise.

## Reading the Provides

The guard's return value lands in the guarded route's unit as the
`provided` port. The guarantee is constructive: the route can only be open
because the guard passed, so `provided` is `Option.some` whenever `opened`
is `true`.

```ts
const readProvided = Effect.gen(function* () {
  const unit = yield* Model.get(AdminRouteModel, "dashboard");
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
