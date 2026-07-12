---
title: "Router: React"
description: One stitching map connects routes, page models, and views; Link renders real anchors typed against the route table.
---

React meets the router in exactly one place: `RouterView.make` takes the
navigation model and a map from route ids to views. Everything else — data,
guards, navigation — already happened on the model side.

## Page Views

A page view is a plain `View.make` over the page model, like any other view
in the system. It renders the query's `AsyncResult`; it knows nothing about
routing.

```tsx
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
```

## The Stitching Map

Two kinds of entries:

- a **plain function** is a view: it receives the bound `router`, its
  route's narrowed `match`, and the deeper match as `children` — use it for
  layouts and routes without a model;
- a **`View.make` component** is its own entry: the router leases its model
  and hands the unit back in. `user: UserPage` is the whole stitching.

```tsx
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
```

Map keys are constrained to the router's route ids — a typo does not
compile. `home` here has no declared children (no `Route.addChild`), so its
`children` is always `null` — `/login`, `/admin`, or any other unrelated
route never renders inside it just because it also starts with `/`. A route
only receives another's rendered output as `children` when the route table
says so explicitly — see the next section.

## Route-Fed Page Views

A third kind of entry: a self-leasing `View.make(Model, render, options)`
(the third, `{building?, failed?}` argument — see
[Lease a Model Directly](/react/#lease-a-model-directly)), for a page model
KEYED by its own route's `Route.Output` (see [Router: Middleware](/router/middleware/#getting-provides-into-a-page-model)).
Where a plain, two-argument `View.make` page expects its unit already
resolved, a self-leasing one leases its model itself — lazily, the moment
the route first matches — and the router feeds the matched route's own
Output in as its key automatically. `make()` gets real, typed data on its
very first line: no placeholder, no `Option`, no race with a `Query`
dependency at construction.

```tsx
import { View } from "@unitflow/react";

// Keyed by the route's own Output — no placeholder, no Option, real data
// on the very first line of make(), for a value the model needs
// immediately (e.g. as a Query dependency), not just to re-expose later.
export class DashboardRouteViewModel extends Model.Service<DashboardRouteViewModel>()(
  "docs/DashboardRouteView",
)<{ readonly user: string }>()({
  make: ({ user }) =>
    Effect.gen(function* () {
      const greeting = Store.make(`Hello, ${user}`);
      return { inputs: {}, outputs: {}, ui: { greeting } };
    }),
}) {}

// The third argument (`{}`) is what makes this View lease its model
// ITSELF, by key, instead of expecting an already-resolved `unit` prop.
const DashboardRouteView = View.make(DashboardRouteViewModel, ({ greeting }) => <p>{greeting}</p>, {});

// A self-leasing entry skips the eager page-model machinery entirely — the
// router leases the model itself, lazily, the moment "dashboard" matches.
export const AdminRouteViewApp = RouterView.make(AdminRouter.model, {
  routes: { dashboard: DashboardRouteView },
});
```

This is the exact same overload documented in
[Lease a Model Directly](/react/#lease-a-model-directly) — nothing
router-specific lives inside `View.make` itself; `RouterView.make` simply
recognizes a self-leasing entry (from the value alone, not by name) and
feeds the matched route's `provided` in as its `modelKey` automatically,
instead of you passing one by hand. The key must match the route's
`Route.Output` exactly — a model keyed by the wrong type, wired into the
wrong route id, fails to compile at the `RouterView.make({ routes: {...} })`
call site.

## Nesting the Views Map

A route's view nests the same way its declaration does: a `{ view, routes }`
node, keyed exactly like the route table's own `Route.addChild`/`Route.layout`
hierarchy ([Routes](/router/routes/#nesting-routeaddchild-and-routelayout)).
The route table here declares `ProjectRoute.pipe(Route.addChild(EditRoute))` —
`/projects/:projectId` owns `/projects/:projectId/edit` as its child page:

```ts
export class ProjectPageModel extends Model.Service<ProjectPageModel>()("docs/ProjectPage")({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(AppRouter.routeModel, "project");
      // outputs (not just ui): ProjectEditModel leases this model via
      // Model.get below, and Model.get reads a model's outputs, not its ui.
      return {
        inputs: {},
        outputs: { params: unit.outputs.params },
        ui: { params: unit.outputs.params },
      };
    }),
}) {}

// Leases ProjectPageModel's already-loaded data (Model.get, a shared
// singleton) instead of duplicating the fetch or threading routing logic
// through either model.
export class ProjectEditModel extends Model.Service<ProjectEditModel>()("docs/ProjectEdit")({
  make: () =>
    Effect.gen(function* () {
      const project = yield* Model.get(ProjectPageModel);
      return { inputs: {}, outputs: {}, ui: { params: project.outputs.params } };
    }),
}) {}
```

```tsx
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

export const NestedAppView = RouterView.make(AppRouter.model, {
  routes: {
    project: { view: ProjectPage, routes: { edit: ProjectEditView } },
  },
});
```

`ProjectPage` receives `ProjectEditView`'s rendered output as `children`
only while `/projects/:projectId/edit` is actually matched — `null`
otherwise, the same `children ?? fallback` shape as before. A node with no
`routes` simply leaves any deeper match unwrapped, so a leaf entry like
`user: UserPage` above still works exactly as shown.

The two page models stay siblings — `ProjectPageModel` doesn't know an edit
view exists, `ProjectEditModel` doesn't know how it got mounted. Nesting is
purely a routing/rendering concern, declared once in the route table and
mirrored once in the views map.

`Link` renders a real `<a href>` — middle-click, cmd-click, and copy work —
and intercepts plain left clicks into `navigate`. Under a `RouterView` it
needs no props beyond the target: the bound router arrives via context, and
`to`/`params`/`search` are typed by the [registered router](/router/routes/#creating-the-router).

## Typing `Link`/`Navigate`/`MatchRoute` without global registration

`Link`/`Navigate`/`MatchRoute` pick up their bound router from React context
at **runtime** — TypeScript cannot see through that to type `to`/`params`,
so it needs SOME static source for which router's route table applies.
`declare module { Register }` (above) is one: a one-time, app-wide ambient
default.

`RouterView.bindComponents(router)` is the structural alternative: same
`Link`/`Navigate`/`MatchRoute`, just re-typed to the router you pass in — no
`declare module`, no ambient state, and it works for an app with more than
one router (each bound to its own).

```tsx
export const { Link, Navigate, MatchRoute } = RouterView.bindComponents(AppRouter.model);
```

Import THESE from your routes module everywhere instead of the ones from
`@unitflow/router/react` — `bindComponents` doesn't read `router` at
runtime (only its type), so this costs nothing beyond the import.

## Mounting

`RouterView.make` returns a component that carries its own root model:
`AppView.model` owns the navigation model and every page model stitched
into the map. Root the tree with it and provide the layers.

```tsx
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { Router } from "@unitflow/router";
import { AppRouter } from "./routes";

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
```

For units that are not a route's page — a session model a layout badge
reads, for example — `RouterView.make` accepts a `Units` type parameter and
the component takes a `units` prop; every plain-function entry receives it.
See the [`router-guard` example](https://github.com/timurrakhimzhan/unitflow/tree/main/examples/ts/router-guard)
for the full pattern.

Next: [guarding sections with middleware](/router/middleware/).
