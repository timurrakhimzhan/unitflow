---
title: "Router: The Two Models"
description: NavigationModel and RouteModel — navigating through events, reading route state through ports, and gating page data with Query.
---

`Router.make` returns two ordinary Unitflow models. There is no controller
object and no hooks: actions are input events, state is output stores —
exactly like every other model in the system.

- **`NavigationModel`** — the engine. `inputs.navigate` drives transitions,
  `outputs.state`/`location` expose where the app is. `buildHref` and
  `buildLocation` live on the model value.
- **`RouteModel`** — keyed by route id. `Model.get(RouteModel, "user")`
  returns that route's unit: occupancy and decoded params/search, narrowed
  to **that route's** schemas.

## Route Units

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Event, Model, Query, Registry, Store } from "@unitflow/core";
import { Router } from "@unitflow/router";
import { NavigationModel, RouteModel } from "./routes";

const program = Effect.gen(function* () {
  const unit = yield* Model.get(RouteModel, "user");

  const opened = yield* Store.get(unit.outputs.opened); // boolean
  const params = yield* Store.get(unit.outputs.params); // Option<{ id: number }>
  const search = yield* Store.get(unit.outputs.search); // Option (this route has none)

  if (Option.isSome(params)) {
    const id: number = params.value.id; // decoded by the schema
    void id;
  }
  void opened;
  void search;
});
```

Every port is an `Option`: `none` while the route is off screen, `some`
while it is open. The ports are live stores — they change on every
navigation, so anything combined from them reacts automatically.

## Page Data: a Model Gated on Route Ports

There are no loaders. A page's data belongs to the page's own model, and
the route unit's ports are ordinary `Query` dependencies: entering the
route loads, changing the id reloads, leaving fails the query into a
`"closed"` state.

```ts
interface User {
  readonly id: number;
  readonly name: string;
}
declare const fetchUser: (id: number) => Effect.Effect<User, "not found">;

export class UserPageModel extends Model.Service<UserPageModel>()("docs/UserPage")({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(RouteModel, "user");
      const user = yield* Query.make({
        stores: { params: unit.outputs.params },
        handler: ({ params }) =>
          Option.isNone(params)
            ? Effect.fail("closed" as const)
            : fetchUser(params.value.id),
      });
      return {
        inputs: {},
        outputs: {},
        ui: { user: user.state, refresh: user.refresh },
      };
    }),
}) {}
```

Revalidation is per page — `Event.emit(model.ui.refresh)` — not a global
router invalidate.

## Navigating

Navigation is an event, like any model input. When a program needs the
outcome, it waits on the state store — the same idiom as waiting on a
query.

```ts
const goToUser = Effect.gen(function* () {
  const nav = yield* Model.get(NavigationModel);

  yield* Event.emit(nav.inputs.navigate, {
    to: "/users/:id",
    params: { id: 42 }, // number: encoded by the schema on the way out
  });

  // navigation is an event; when a program needs the result, wait on state
  yield* Store.waitFor(nav.outputs.state, (state) => state.status !== "pending");
  const location = yield* Store.get(nav.outputs.location);
  void location.pathname; // "/users/42"
});
```

`to` is constrained to the router's declared paths; `params` and `search`
follow the target route's schemas. A typo in any of them does not compile.

## Building Hrefs

```ts
const shareLink = Effect.gen(function* () {
  const href = yield* NavigationModel.buildHref({
    to: "/users",
    search: { page: 2, sort: "desc", filter: { role: "admin" } },
  });
  void href; // "/users?filter=%7B%22role%22%3A%22admin%22%7D&page=2&sort=desc"
});
```

## History Is a Capability

`Router.make` declares routes only. How locations are read and written is
decided by the layer: `Router.browserHistoryLayer` in the app,
`Router.hashHistoryLayer` for hash routing, `Router.memoryHistoryLayer` in
tests. Forgetting one is a compile error, not a silent default.

```ts
import * as Layer from "effect/Layer";

// Tests drive the router with an in-memory history:
const testLayer = RouteModel.layer.pipe(
  Layer.provideMerge(NavigationModel.layer),
  Layer.provideMerge(Router.memoryHistoryLayer({ initialEntries: ["/users/7"] })),
  Layer.provideMerge(Registry.layer),
);

export const test = Effect.provide(
  Effect.all([program, goToUser, shareLink]),
  testLayer,
);
```

Next: [connecting the router to React](/router/react/).
