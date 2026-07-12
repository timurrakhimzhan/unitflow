// Compile-checked snippets for the "Router: React" doc page.

// #region views
import { View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";
import { AppRouter } from "./routes";
import { UserLoaderLive, UserPageModel } from "./models";

const UserPage = View.make(
  UserPageModel,
  ({ profile, rename }) => (
    <section>
      <h2>{profile.name}</h2>
      <button onClick={() => rename(`${profile.name}!`)}>Rename locally</button>
    </section>
  ),
  {},
);
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
    // This self-leasing View is constructed only after UserLoader succeeds;
    // the middleware's { user } output becomes UserPageModel's key.
    user: UserPage,
  },
  notFound: () => <p>404</p>,
});
// #endregion stitch

// #region nested-recipe
// A route's view nests the same way its declaration does — a
// `{ view, routes }` node, keyed like the route table's own hierarchy.
// The project view receives the edit view's rendered output as `children` only
// while "/projects/:projectId/edit" is actually matched — `null` otherwise.
export const NestedAppView = RouterView.make(AppRouter.model, {
  routes: {
    project: {
      view: ({ match, children }) => (
        <section>
          <h2>Project {match.params.projectId}</h2>
          {children ?? <p>Overview.</p>}
        </section>
      ),
      routes: { edit: () => <p>Edit form…</p> },
    },
  },
});
// #endregion nested-recipe

// #region bind-components
export const {
  Link: BoundLink,
  Navigate: BoundNavigate,
  MatchRoute: BoundMatchRoute,
} = RouterView.bindComponents(AppRouter.model);
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
  Layer.provideMerge(UserLoaderLive),
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
