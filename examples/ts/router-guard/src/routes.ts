import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Model, Store } from "@unitflow/react";
import { Router } from "@unitflow/router";
import { SessionModel } from "./session";

/** The guard is a TAG: the router only ever requires it — the
 * implementation and ITS dependencies live in `AuthGuardLive` below.
 * `<{ user: string }>` declares what a passing guard provides. */
export class AuthGuard extends Router.Middleware<AuthGuard>()(
  "@unitflow/example/router-guard/AuthGuard",
)<{ readonly user: string }>() {}

export const HomeRoute = Router.route("home", { path: "/" });
export const LoginRoute = Router.route("login", { path: "/login" });
export const AdminRoute = Router.route("admin", { path: "/admin" });

export const { model: NavigationModel } = Router.make(
  "@unitflow/example/router-guard/router",
  Router.group(HomeRoute, LoginRoute).merge(
    Router.group(AdminRoute).middleware(AuthGuard),
  ),
);

declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof NavigationModel;
  }
}

/** Runs BEFORE a navigation to /admin commits: no session — redirect, the
 * blocked URL never flashes. On success the returned value lands in the
 * route unit's `provided` port and in `match.provided`, typed. */
export const AuthGuardLive = AuthGuard.make((context) =>
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
