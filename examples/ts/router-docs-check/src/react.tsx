// Compile-checked snippets for the "Router: React" doc page.

// #region views
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Option from "effect/Option";
import { View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";
import { AppRouter, UserRoute } from "./routes";
import { UserPageModel } from "./models";

const UserPage = View.make(UserPageModel, ({ user, refresh }) => {
  const value = AsyncResult.value(user);
  if (Option.isNone(value)) {
    return user.waiting || !AsyncResult.isFailure(user) ? (
      <p>Loading…</p>
    ) : (
      <p>Not found</p>
    );
  }
  return (
    <section>
      <h2>{value.value.name}</h2>
      <button onClick={() => refresh()}>Reload</button>
    </section>
  );
});
// #endregion views

// #region stitch
export const AppView = RouterView.make(AppRouter.model, {
  routes: {
    // a plain function is a view: it gets the bound router, its route's
    // narrowed match, and the deeper match as children
    home: ({ children }) => (
      <main>
        <nav>
          <Link to="/users" search={{ page: 1, sort: "asc", filter: { role: "admin" } }}>
            People
          </Link>
          <Link to="/users/:id" params={{ id: 1 }}>
            Ada
          </Link>
        </nav>
        {children ?? <p>Pick a page.</p>}
      </main>
    ),
    // a View.make component IS its own entry: the router leases its model
    // and hands the unit back in
    user: UserPage,
  },
  notFound: () => <p>404</p>,
});
// #endregion stitch

// #region nested-recipe
import { ProjectEditModel, ProjectPageModel } from "./models";

const ProjectPage = View.make(
  ProjectPageModel,
  ({ params }, { children }: { readonly children?: React.ReactNode }) => (
    <section>
      <h2>Project {Option.isSome(params) ? params.value.projectId : ""}</h2>
      {children ?? <p>Overview.</p>}
    </section>
  ),
);

const ProjectEditView = View.make(ProjectEditModel, () => <p>Edit form…</p>);

// A route's view nests the same way its declaration does — a
// `{ view, routes }` node, keyed like the route table's own hierarchy.
// ProjectPage receives ProjectEditView's rendered output as `children` only
// while "/projects/:projectId/edit" is actually matched — `null` otherwise.
export const NestedAppView = RouterView.make(AppRouter.model, {
  routes: {
    project: { view: ProjectPage, routes: { edit: ProjectEditView } },
  },
});
// #endregion nested-recipe

// #region bind-components
export const {
  Link: BoundLink,
  Navigate: BoundNavigate,
  MatchRoute: BoundMatchRoute,
} = RouterView.bindComponents(AppRouter.model);
void BoundLink;
void BoundNavigate;
void BoundMatchRoute;
// #endregion bind-components

// #region mount
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { Router } from "@unitflow/router";

const layer = AppView.model.layer.pipe(
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(AppRouter.layer),
  Layer.provideMerge(Router.browserHistoryLayer),
);
const runtime = UnitflowRuntime.make(layer);

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* the view carries its own root model */}
    <Unitflow runtime={runtime} rootModel={AppView.model}>
      {(pages) => <AppView unit={pages} />}
    </Unitflow>
  </React.StrictMode>,
);
// #endregion mount

void UserRoute;
