---
title: "Router: React"
description: Connect middleware-fed page models to React with one typed routes map and real anchor links.
---

React meets the router in one place: `RouterView.make` takes the navigation
model and a map from route ids to views. Fetching, access checks, and page
state stay in middleware and models.

## A Middleware-Fed Page View

`UserPageModel` is keyed by `Route.Output<typeof UserRoute>`. Use the
three-argument, self-leasing `View.make` overload so the router can construct
it lazily with the successful middleware output:

```tsx
import { View } from "@unitflow/react";
import { Link, RouterView } from "@unitflow/router/react";
import { AppRouter } from "./routes";
import { UserLoaderLive, UserPageModel } from "./models";

const UserPage = View.make(
  UserPageModel,
  ({ profile, rename }) => (
    <section>
      <h2>{profile.name}</h2>
      <button onClick={() => rename(`${profile.name}!`)}>
        Rename locally
      </button>
    </section>
  ),
  {},
);
```

The third argument is the important part. A two-argument `View.make` expects
an already-resolved singleton unit; the self-leasing overload owns a keyed
model lease. `RouterView` supplies `match.provided` as that key. Until
`UserLoader` succeeds, this model and view do not exist.

The model key must exactly match the route's `Route.Output`. Wiring a model
with the wrong middleware contract to `user` fails at the routes map.

## The Routes Map

A routes-map entry is either:

- a plain render function, which receives the bound `router`, its narrowed
  `match`, shared `units`, and rendered `children`; or
- a `View.make` component. A self-leasing component receives middleware
  output as its model key automatically.

```tsx
export const AppView = RouterView.make(AppRouter.model, {
  routes: {
    home: ({ children }) => (
      <main>
        <nav>
          <Link
            to="/users"
            search={{ page: 1, sort: "asc", filter: { role: "admin" } }}
          >
            People
          </Link>
          <Link to="/users/:id" params={{ id: 1 }}>
            Ada
          </Link>
        </nav>
        {children ?? <p>Pick a page.</p>}
      </main>
    ),
    // UserLoader has already produced { user } before this lease starts.
    user: UserPage,
  },
  notFound: () => <p>404</p>,
});
```

Map keys are constrained to route ids. `Link` targets, path params, and
search params are constrained to the registered route table. `Link` renders a
real `<a href>` and only intercepts ordinary left clicks, so middle-click,
cmd-click, copy, and browser accessibility behavior keep working.

## Nesting the Routes Map

Views nest only where the route table declares `Route.addChild` or
`Route.layout`. Mirror that hierarchy with `{ view, routes }`:

```tsx
export const NestedAppView = RouterView.make(AppRouter.model, {
  routes: {
    project: {
      view: ({ match, children }) => (
        <section>
          <h2>Project {match.params.projectId}</h2>
          {children ?? <p>Overview.</p>}
        </section>
      ),
      routes: {
        edit: () => <p>Edit form…</p>,
      },
    },
  },
});
```

The project view receives the edit page as `children` only for
`/projects/:projectId/edit`. Routes that merely share a path prefix do not
accidentally render inside one another.

## Local Component Typing Instead of Global Registration

`Link`/`Navigate`/`MatchRoute` get their router from React context at runtime,
so TypeScript needs a static route table. Ambient `Register` is one option.
For multiple routers or explicit imports, bind the component types instead:

```tsx
export const {
  Link: BoundLink,
  Navigate: BoundNavigate,
  MatchRoute: BoundMatchRoute,
} = RouterView.bindComponents(AppRouter.model);
```

Import these bound components from the routes module. Binding is type-only;
the runtime router still comes from the nearest `RouterView`.

## Mounting

`AppView.model` owns the navigation model and the page models represented in
the routes map. The runtime supplies the page model, router, middleware, and
history layers:

```tsx
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
    <Unitflow runtime={runtime} rootModel={AppView.model}>
      {(pages) => <AppView unit={pages} />}
    </Unitflow>
  </React.StrictMode>,
);
```

Leaving out `UserLoaderLive` does not compile: the route table requires the
middleware tag that produces `UserPageModel`'s key.

For units that are not route pages—such as a session model rendered in a
layout—`RouterView.make` accepts a `Units` type parameter and the component
takes a `units` prop. See the runnable
[`router-basic` example](https://github.com/timurrakhimzhan/unitflow/tree/main/examples/ts/router-basic)
for middleware-fed page data, and
[`router-guard` example](https://github.com/timurrakhimzhan/unitflow/tree/main/examples/ts/router-guard)
for a session model shared with a layout.
