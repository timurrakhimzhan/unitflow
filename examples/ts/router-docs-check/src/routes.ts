// Compile-checked snippets for the "Router: Routes and Schemas" doc page.
// Doc code blocks are exact segments of this file — keep them in sync.

// #region declare
import * as Schema from "effect/Schema";
import { Route, Router } from "@unitflow/router";

export const HomeRoute = Route.make("home", { path: "/" });
export const LoginRoute = Route.make("login", { path: "/login" });
// #endregion declare

// #region params
const userParams = Schema.Struct({ id: Schema.NumberFromString });

export const UserRoute = Route.make("user", {
  path: "/users/:id",
  params: userParams,
});
// Without a schema, params stay raw strings typed from the path:
export const FileRoute = Route.make("file", { path: "/files/*path" });
export const DraftRoute = Route.make("draft", { path: "/drafts/:id?" });
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

export const UsersRoute = Route.make("users", {
  path: "/users",
  search: usersSearch,
});
// #endregion search

// #region groups
const publicRoutes = Route.group(HomeRoute, LoginRoute);
const userRoutes = Route.group(UsersRoute, UserRoute);

// merge and prefix compose groups; ids must stay unique
const allRoutes = publicRoutes
  .merge(userRoutes)
  .merge(Route.group(FileRoute, DraftRoute).prefix("/storage"));
// #endregion groups

// #region hierarchy
const EditRoute = Route.make("edit", { path: "/edit" });
// ProjectRoute owns EditRoute: /projects/:projectId/edit is its child page,
// not an unrelated route that happens to share a path prefix.
export const ProjectRoute = Route.make("project", {
  path: "/projects/:projectId",
  params: Schema.Struct({ projectId: Schema.NumberFromString }),
}).pipe(Route.addChild(EditRoute));

// Route.layout wraps otherwise-unrelated siblings under a shared, pathless
// parent — for a shell around resources that aren't nested in each other.
const SettingsRoute = Route.make("settings", { path: "/settings" });
const ReportsRoute = Route.make("reports", { path: "/reports" });
const dashboardArea = Route.group(SettingsRoute, ReportsRoute).pipe(Route.layout("dashboard"));
// #endregion hierarchy

// #region make
export const AppRouter = Router.make(
  "docs/router",
  allRoutes.merge(Route.group(ProjectRoute)).merge(dashboardArea),
);

// Registering the router types Link/redirect targets application-wide.
declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof AppRouter.model;
  }
}
// #endregion make
