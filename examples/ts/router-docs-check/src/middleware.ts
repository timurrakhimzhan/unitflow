// Compile-checked snippets for the "Router: Middleware" doc page.

// #region declare
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
// #endregion declare

// #region implement
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
// #endregion implement

// #region attach
const DashboardRoute = Route.make("dashboard", { path: "/dashboard" });
const MembersRoute = Route.make("members", { path: "/members" });

const adminRoutes = Route.group(DashboardRoute, MembersRoute)
  .middleware(AuthGuard)
  .prefix("/admin");

export const AdminRouter = Router.make(
  "docs/admin-router",
  Route.group(Route.make("home", { path: "/" })).merge(adminRoutes),
);
// #endregion attach

// #region provided
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
void readProvided;
// #endregion provided

// #region forward
import { View } from "@unitflow/react";

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

// The third argument (`{}`) is what makes this View lease its model
// ITSELF, by key — the router feeds the matched route's own Output in.
export const DashboardView = View.make(DashboardPageModel, ({ greeting }) => greeting, {});
// #endregion forward
