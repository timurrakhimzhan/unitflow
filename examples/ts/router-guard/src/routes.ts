import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Model, Store } from "@unitflow/react";
import { Route, Router } from "@unitflow/router";
import { SessionModel } from "./session";

/** The guard is a TAG: the router only ever requires it — the
 * implementation and ITS dependencies live in `AuthGuardLive` below.
 * `<{ user: string }>` declares what a passing guard provides. */
export class AuthGuard extends Router.Middleware<AuthGuard>()(
  "@unitflow/example/router-guard/AuthGuard",
)<{ readonly user: string }>() {}

export const HomeRoute = Route.make("home", { path: "/" });
export const LoginRoute = Route.make("login", { path: "/login" });
export const AdminRoute = Route.make("admin", { path: "/admin" });

/** home/login/admin are independent pages, not one another's content — they
 * share a nav/session-badge shell only because `Route.layout` says so. Under
 * the old degenerate `/` prefix-match this fell out "for free"; explicit
 * hierarchy means declaring it, same as the guard scope below. */
export const AppRouter = Router.make(
  "@unitflow/example/router-guard/router",
  Route.group(HomeRoute, LoginRoute)
    .merge(Route.group(AdminRoute).middleware(AuthGuard))
    .pipe(Route.layout("shell")),
);

declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof AppRouter.model;
  }
}

/** Runs BEFORE a navigation to /admin commits: no session — redirect, the
 * blocked URL never flashes. On success the returned value lands in the
 * route unit's `provided` port and in `match.provided`, typed. */
export const AuthGuardLive = AuthGuard.layer((context) =>
  Effect.gen(function* () {
    const session = yield* Model.get(SessionModel);
    const user = yield* Store.get(session.outputs.user);
    if (Option.isNone(user)) {
      return yield* Effect.fail(
        // `to` is typed against the registered router: "/loginn" won't compile.
        new Router.RedirectError({ options: { to: "/login" } }),
      );
    }
    void context;
    return { user: user.value };
  }),
);
