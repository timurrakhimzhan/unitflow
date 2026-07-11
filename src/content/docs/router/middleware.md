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

## Forwarding Provides Into a Page Model

Reading `unit.outputs.provided` from inside a page model works, but it
duplicates the `Option.isSome` check the guard already did — the model
can't be open unless the guard already passed. `Router.makePages` closes
this by name: declare an input with the same name as a field of the
route's `Route.Output`, and it's forwarded automatically on every
navigation — no `Option`, no manual wiring.

```ts
// NOT Option — makePages only ever writes here while "dashboard" is matched.
// Store.input: the model reads `user`, never sets it — makePages is the
// only writer, through the Sink the same name gets narrowed to in `inputs`.
export class DashboardPageModel extends Model.Service<DashboardPageModel>()(
  "docs/DashboardPage",
)({
  make: () =>
    Effect.gen(function* () {
      const user = Store.input("");
      return { inputs: { user }, outputs: {}, ui: { user } };
    }),
}) {}

// a name (`user`) that names a field of BOTH the model's inputs and the
// route's Route.Output gets forwarded automatically on every navigation —
// no manual wiring. A disagreeing type at that name is a compile error.
export const adminPages = Router.makePages(AdminRouter.model, { dashboard: DashboardPageModel });
```

`Store.input` hands the model a read-only `Source`: the page model itself
can `Store.get`/`Store.stream` its own `user`, but calling `Store.set` on it
inside its own `make` fails to compile — only external code (`makePages`'s
forwarding here) can write it, through the `Sink` the same store is
narrowed to once placed in `inputs`.

The match is by name only, not position: a model that doesn't declare a
matching input simply never receives anything, and a name present on both
sides with disagreeing types fails to compile — `Router.makePages`
(and [`RouterView.make`](/router/react/), which calls it internally)
checks every page model against its route's `Route.Output` before anything
runs. This is also how a future loader would plug in: as a middleware that
provides the fetched data, forwarded into the page model the same way.
