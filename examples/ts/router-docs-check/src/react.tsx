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

// #region routeview
import * as Effect from "effect/Effect";
import { Model, Store } from "@unitflow/core";
import { AdminRouter } from "./middleware";

// Keyed by the ROUTE's own Output — no placeholder, no Option, real data
// on the very first line of make(), for a value the model needs immediately
// (e.g. as a Query dependency at construction), not just to re-expose later.
export class DashboardRouteViewModel extends Model.Service<DashboardRouteViewModel>()(
  "docs/DashboardRouteView",
)<{ readonly user: string }>()({
  make: ({ user }) =>
    Effect.gen(function* () {
      const greeting = Store.make(`Hello, ${user}`);
      return { inputs: {}, outputs: {}, ui: { greeting } };
    }),
}) {}

// The third, self-leasing argument (`{}` here) is what makes this lease
// ITSELF, keyed by whatever `modelKey` it's handed — the router feeds
// the matched route's own Output in automatically.
const DashboardRouteView = View.make(DashboardRouteViewModel, ({ greeting }) => <p>{greeting}</p>, {});

// A self-leasing entry skips makePages entirely — the router leases the
// model itself, lazily, the moment "dashboard" first matches.
export const AdminRouteViewApp = RouterView.make(AdminRouter.model, {
  routes: { dashboard: DashboardRouteView },
});
// #endregion routeview

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

// #region validate-negative
// Not a doc snippet — a regression check: RouterView.make must reject a
// self-leasing View.make entry keyed by something other than its route's
// own Route.Output, at the position it's wired into.
class MismatchedRouteViewModel extends Model.Service<MismatchedRouteViewModel>()(
  "docs/MismatchedRouteView",
)<{ readonly user: number }>()({
  // number, but Route.Output's user is a string
  make: () =>
    Effect.gen(function* () {
      return { inputs: {}, outputs: {}, ui: {} };
    }),
}) {}

const MismatchedRouteView = View.make(MismatchedRouteViewModel, () => null, {});

export const BadAdminView = RouterView.make(AdminRouter.model, {
  routes: {
    // @ts-expect-error MismatchedRouteViewModel's key disagrees with Route.Output's user: string
    dashboard: MismatchedRouteView,
  },
});
// #endregion validate-negative
