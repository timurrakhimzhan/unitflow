// Compile-checked snippets for the "Router: Middleware" doc page.

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Model, Store } from "@unitflow/core";
import { View } from "@unitflow/react";
import { Route, Router } from "@unitflow/router";

// #region declare
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
// #endregion declare

// #region implement
export const AuthGuardLive = AuthGuard.layer(() =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const user = yield* session.currentUser;
    if (Option.isNone(user)) {
      return yield* Effect.fail(new Router.RedirectError({ options: { to: "/login" } }));
    }
    return { user: user.value };
  }),
);

export const AuditContextLive = AuditContext.layer(() =>
  Effect.succeed({ auditId: "admin-navigation" }),
);
// #endregion implement

// #region attach
export const DashboardRoute = Route.make("dashboard", { path: "/dashboard" }).pipe(
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
// #endregion attach

// #region page-model
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
// #endregion page-model
