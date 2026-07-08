// Compile-checked snippets for the "Router: Routes and Schemas" doc page.
// Doc code blocks are exact segments of this file — keep them in sync.

// #region declare
import * as Schema from "effect/Schema";
import { Router } from "@unitflow/router";

export const HomeRoute = Router.route("home", { path: "/" });
export const LoginRoute = Router.route("login", { path: "/login" });
// #endregion declare

// #region params
const userParams = Schema.Struct({ id: Schema.NumberFromString });

export const UserRoute = Router.route("user", {
  path: "/users/:id",
  params: userParams,
});
// Without a schema, params stay raw strings typed from the path:
export const FileRoute = Router.route("file", { path: "/files/*path" });
export const DraftRoute = Router.route("draft", { path: "/drafts/:id?" });
// #endregion params

// #region search
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
// #endregion search

// #region groups
const publicRoutes = Router.group(HomeRoute, LoginRoute);
const userRoutes = Router.group(UsersRoute, UserRoute);

// merge and prefix compose groups; ids must stay unique
const allRoutes = publicRoutes
  .merge(userRoutes)
  .merge(Router.group(FileRoute, DraftRoute).prefix("/storage"));
// #endregion groups

// #region make
export const { NavigationModel, RouteModel } = Router.make("docs/router", allRoutes);

// Registering the router types Link/redirect targets application-wide.
declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof NavigationModel;
  }
}
// #endregion make
