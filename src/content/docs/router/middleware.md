---
title: "Router: Middleware"
description: Run access checks and one-shot loaders before navigation commits, then feed typed output into page models.
---

Middleware is the route's pre-commit pipeline. It can check access, redirect,
return not-found, load one-shot data, or add request context. The target route
does not enter history or router state until every matched middleware succeeds.

A middleware is a Context-service tag. The route table requires the tag; its
implementation and dependencies live in a layer. Its success type is its
`Provides`, accumulated into the route's `Route.Output`.

## Declare Middleware Contracts

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Model, Store } from "@unitflow/core";
import { View } from "@unitflow/react";
import { Route, Router } from "@unitflow/router";

interface SessionShape {
  readonly currentUser: Effect.Effect<Option.Option<string>>;
}
export class SessionService extends Context.Service<SessionService, SessionShape>()(
  "docs/Session",
) {}

export class AuthGuard extends Router.Middleware<AuthGuard>()("docs/AuthGuard")<{
  readonly user: string;
}>() {}

export class AuditContext extends Router.Middleware<AuditContext>()("docs/AuditContext")<{
  readonly auditId: string;
}>() {}
```

The router sees only `AuthGuard` and `AuditContext`. It does not inherit their
implementation dependencies.

## Implement the Tags in Layers

`Middleware.layer` captures the handler's Effect services when the layer is
built while still executing fresh handler logic on each navigation:

```ts
export const AuthGuardLive = AuthGuard.layer(() =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const user = yield* session.currentUser;
    if (Option.isNone(user)) {
      return yield* Effect.fail(
        new Router.RedirectError({ options: { to: "/login" } }),
      );
    }
    return { user: user.value };
  }),
);

export const AuditContextLive = AuditContext.layer(() =>
  Effect.succeed({ auditId: "admin-navigation" }),
);
```

Redirects and `NotFoundError` work for link navigation, initial deep links,
and browser back/forward. A rejected URL never flashes as the active route.

## Attach Middleware to Routes

Attach tags with route combinators. Several middleware on one route run
sequentially by default; opt into concurrency only when they are independent:

```ts
export const DashboardRoute = Route.make("dashboard", {
  path: "/dashboard",
}).pipe(
  Route.middleware(AuthGuard),
  Route.middleware(AuditContext),
  Route.middlewaresConcurrency("unbounded"),
);

const MembersRoute = Route.make("members", { path: "/members" }).pipe(
  Route.middleware(AuthGuard),
);

const adminRoutes = Route.group(DashboardRoute, MembersRoute).prefix("/admin");

export const AdminRouter = Router.make(
  "docs/admin-router",
  Route.group(Route.make("home", { path: "/" })).merge(adminRoutes),
);
```

`Route.group(...).middleware(AuthGuard)` is shorthand for attaching the tag to
every route currently in that group. When a guarded route is an explicit
`addChild`/`layout` ancestor, its middleware already covers descendants. Parent
middleware always runs before child middleware.

`middlewaresConcurrency` affects middleware attached at the same route level
only. Parent and child levels remain ordered so a parent redirect prevents
child work from starting.

## Consume `Route.Output` in the Page Model

Do not construct a page singleton and then read `route.outputs.provided` as an
`Option`. The route could not have opened without successful middleware. Key
the page model by that proof instead:

```ts
export class DashboardPageModel extends Model.Service<DashboardPageModel>()(
  "docs/DashboardPage",
)<Route.Output<typeof DashboardRoute>>()({
  make: ({ user, auditId }) =>
    Effect.gen(function* () {
      const greeting = Store.make(`Hello, ${user} (${auditId})`);
      return { inputs: {}, outputs: { greeting }, ui: { greeting } };
    }),
}) {}

export const DashboardView = View.make(
  DashboardPageModel,
  ({ greeting }) => greeting,
  {},
);
```

The router merges middleware output in declaration order, so this route's
output is `{ user: string } & { auditId: string }`. `RouterView` leases the
model only after both values exist. A missing middleware layer or mismatched
page-model key fails at compile time.

## Loading Data

A one-shot request is valid middleware work: fetch the resource, map domain
errors to `RedirectError`/`NotFoundError`, and return the resource as
`Provides`. The [models page](/router/models/#load-during-navigation) shows a
complete parametric `UserLoader`.

Do not call `Query.make`, `Event.handler`, `Store.forwardTo`, or other ongoing
reactive constructors inside middleware. Middleware runs again on every
navigation and does not own an instance lifetime, so that would create a new
pipeline on every visit. The type system rejects these APIs there because they
require `InstanceScope`.

When data needs refresh, polling, or reactive dependencies, put the `Query` in
a keyed model. Middleware may lease that model with `Model.get` and provide its
stable output store, or it may perform the initial one-shot fetch and let the
route-fed page model own subsequent refreshes. In both designs, the model owns
subscription lifetime and cleanup.

Next: [turning middleware output into page models](/router/models/).
