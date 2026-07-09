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

## Nesting the Views Map

A route's view nests the same way its declaration does: a `{ view, routes }`
node, keyed exactly like the route table's own `Route.addChild`/`Route.layout`
hierarchy ([Routes](/router/routes/#nesting-routeaddchild-and-routelayout)).

```tsx
export const AppView = RouterView.make(AppRouter.model, {
  routes: {
    home: HomeView, // no children — unchanged shorthand
    project: { view: ProjectPage, routes: { edit: ProjectEditView } },
  },
});
```

`ProjectPage` receives `ProjectEditView`'s rendered output as `children`
only while `/projects/:id/edit` is actually matched — `null` otherwise, the
same `children ?? fallback` shape as before. A node with no `routes` simply
leaves any deeper match unwrapped, so a leaf entry like `user: UserPage`
above still works exactly as shown.

### Recipe: a shared page with an edit sub-view

For "one big page, one small edit view over the same resource," give the
child its own model that leases the parent's (already-loaded) data instead
of duplicating the fetch or threading routing logic through either model:

```ts
export class ProjectEditModel extends Model.Service<ProjectEditModel>()("app/ProjectEdit")({
  make: () =>
    Effect.gen(function* () {
      // Shares ProjectPageModel's already-loaded data — no second fetch,
      // and ProjectEditModel never touches the route directly.
      const project = yield* Model.get(ProjectPageModel);
      return { inputs: {}, outputs: {}, ui: { project: project.outputs.project } };
    }),
}) {}
```

The two stay sibling page models — `ProjectPageModel` doesn't know an edit
view exists, `ProjectEditModel` doesn't know how it got mounted. Nesting is
purely a routing/rendering concern, declared once in the route table and
mirrored once in the views map.

`Link` renders a real `<a href>` — middle-click, cmd-click, and copy work —
and intercepts plain left clicks into `navigate`. Under a `RouterView` it
needs no props beyond the target: the bound router arrives via context, and
`to`/`params`/`search` are typed by the [registered router](/router/routes/#creating-the-router).

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
