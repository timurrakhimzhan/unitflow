---
title: "Router: Models and Route Data"
description: Feed route data through middleware into keyed page models, observe route state, navigate through events, and compose history layers.
---

`Router.make` returns an `AppRouter` made of ordinary Unitflow models:

- **`AppRouter.model`** is the navigation engine. Its `navigate` input changes
  location; its output stores expose router state and the current location.
- **`AppRouter.routeModel`** is keyed by route id. It exposes live
  `opened`/`params`/`search`/`provided` stores for long-lived observers such as
  breadcrumbs and analytics.
- **`AppRouter.layer`** composes both models. The application still chooses a
  history layer and supplies every middleware and page-model layer.

For a routed page, the normal data flow is not “construct a singleton, then
wait for `Option.some(params)`”. Let middleware finish the navigation and
provide the page's real construction key:

```text
route match -> middleware -> Route.Output -> keyed page model -> View
```

## Load During Navigation

The `UserRoute` from the previous page has a `UserLoader` middleware attached.
Its implementation receives the decoded route context, fetches the user, and
maps an application-level miss to the router's typed `NotFoundError`:

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Event, Model, Registry, Store } from "@unitflow/core";
import { Route, Router } from "@unitflow/router";
import { AppRouter, UserLoader, UserRoute, userParams, type User } from "./routes";

declare const fetchUser: (id: number) => Effect.Effect<User, "not found">;

export const UserLoaderLive = UserLoader.layer((context) => {
  if (!Schema.is(userParams)(context.params)) {
    return Effect.fail(new Router.NotFoundError({}));
  }
  return fetchUser(context.params.id).pipe(
    Effect.map((user) => ({ user })),
    Effect.mapError(() => new Router.NotFoundError({})),
  );
});
```

`MiddlewareContext` is intentionally route-agnostic because the same tag can
be attached to several routes. `Schema.is` narrows the reusable handler to the
contract it supports; the router has already decoded the value before calling
it.

Navigation commits only after this effect succeeds. A failure never briefly
opens the page or writes the rejected URL to history.

## Build the Page Model from `Route.Output`

The page model is keyed by exactly what its route's middleware provides. It is
constructed lazily on a successful match, so `make` receives a real `User` on
its first line—no placeholder, no `Option`, and no synthetic `"closed"`
failure. From there it is a normal model with state and inputs:

```ts
export class UserPageModel extends Model.Service<UserPageModel>()(
  "docs/UserPage",
)<Route.Output<typeof UserRoute>>()({
  make: ({ user }) =>
    Effect.gen(function* () {
      const profile = Store.make(user);
      const rename = yield* Event.input<string>().pipe(
        Event.handler((name) =>
          Store.update(profile, (current) => ({ ...current, name })),
        ),
      );
      return {
        inputs: { rename },
        outputs: { profile },
        ui: { profile, rename },
      };
    }),
}) {}
```

The `View.make(Model, render, {})` self-leasing overload connects this keyed
model to `RouterView`; the React page shows the complete wiring on the next
page. If the middleware output and model key disagree, the routes map does not
compile.

Use a `Query` inside this model when the page owns ongoing refresh, polling, or
reactive dependencies. Do not create an ongoing `Query` inside middleware:
middleware runs once per navigation, while model lifetime owns subscriptions
and cleanup.

## Observe a Route Outside Its Page

`AppRouter.routeModel` remains useful for a model that lives independently of
the matched page. Republish its stores as real ports instead of reading them in
a throwaway `program`:

```ts
export class UserRouteStateModel extends Model.Service<UserRouteStateModel>()(
  "docs/UserRouteState",
)({
  make: () =>
    Effect.gen(function* () {
      const route = yield* Model.get(AppRouter.routeModel, "user");
      return {
        inputs: {},
        outputs: {
          opened: route.outputs.opened,
          params: route.outputs.params,
          search: route.outputs.search,
        },
        ui: {
          opened: route.outputs.opened,
          params: route.outputs.params,
          search: route.outputs.search,
        },
      };
    }),
}) {}
```

`params` is `Option<{ id: number }>` here because this observer outlives the
route: it is `none` off-screen and `some` while the route is matched. That is a
useful live-state contract for a breadcrumb; it is unnecessary ceremony for a
page that can instead be constructed from middleware output.

## Navigate from a Model

Navigation is another model input. Wrap it in a domain event rather than
exporting a loose top-level `Effect`:

```ts
export class NavigationModel extends Model.Service<NavigationModel>()("docs/Navigation")({
  make: () =>
    Effect.gen(function* () {
      const router = yield* Model.get(AppRouter.model);
      const openUser = yield* Event.input<number>().pipe(
        Event.handler((id) =>
          Event.emit(router.inputs.navigate, {
            to: "/users/:id",
            params: { id },
          }),
        ),
      );
      const usersHref = yield* AppRouter.model.buildHref({
        to: "/users",
        search: { page: 2, sort: "desc", filter: { role: "admin" } },
      });
      const shareHref = Store.make(usersHref);
      return {
        inputs: { openUser },
        outputs: { location: router.outputs.location, shareHref },
        ui: { openUser, shareHref },
      };
    }),
}) {}
```

`to` is constrained to declared paths, and `params`/`search` use the target
route's schema input types. `buildHref` uses the same contracts and returns the
encoded href.

## History and Layers

Routes do not choose their environment. Applications use
`Router.browserHistoryLayer`; tests swap in memory history:

```ts
import * as Layer from "effect/Layer";

export const testLayer = NavigationModel.layer.pipe(
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(AppRouter.layer),
  Layer.provideMerge(UserLoaderLive),
  Layer.provideMerge(
    Router.memoryHistoryLayer({ initialEntries: ["/users/7"] }),
  ),
  Layer.provideMerge(Registry.layer),
);
```

Forgetting `UserLoaderLive` is a compile error because `AppRouter.layer`
requires every middleware tag attached to its route table.

Next: [connecting the router to React](/router/react/).
