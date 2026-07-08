import * as Schema from "effect/Schema";
import { Router } from "@unitflow/router";

const userParams = Schema.Struct({ id: Schema.NumberFromString });
const userSearch = Schema.Struct({ page: Schema.NumberFromString });

/** Routes declare paths and codecs — no components, no data loading. */
export const HomeRoute = Router.route("home", { path: "/" });
export const UsersRoute = Router.route("users", { path: "/users" });
export const UserRoute = Router.route("user", {
  path: "/users/:id",
  params: userParams,
  search: userSearch,
});

export const AppRouter = Router.make(
  "@unitflow/example/router-basic/router",
  Router.group(HomeRoute, UsersRoute, UserRoute),
  { history: Router.createBrowserHistory() },
);

/** Registering the router types every erased payload — e.g. RedirectError
 * targets — against this exact route table. */
declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof AppRouter;
  }
}
