# @unitflow/router

Effect-native, model-first typed router for Unitflow.

Routes declare paths and codecs — never components, loaders, or data.
`Router.make` births two models the application only names: the engine
(navigation, current location) and a keyed per-route model (occupancy and
decoded params/search). Page data lives in ordinary Unitflow models gated on
route ports; React meets the router in exactly one place.

## Install

```sh
pnpm add @unitflow/router @unitflow/react @unitflow/core effect@4.0.0-beta.88
```

## Routes and models

```ts
import * as Schema from "effect/Schema";
import { Router } from "@unitflow/router";

const userParams = Schema.Struct({ id: Schema.NumberFromString });
const userSearch = Schema.Struct({ page: Schema.NumberFromString });

export const HomeRoute = Router.route("home", { path: "/" });
export const UserRoute = Router.route("user", {
  path: "/users/:id",
  params: userParams,
  search: userSearch,
});

export const { NavigationModel, RouteModel } = Router.make(
  "app/router",
  Router.group(HomeRoute, UserRoute),
);

// Registering the router types Link/redirect targets everywhere.
declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof NavigationModel;
  }
}
```

- `NavigationModel` — the engine: `inputs.navigate` (an event, like any
  model input), `outputs.state`/`location`, `buildHref`/`buildLocation`.
- `RouteModel` — keyed by route id: `Model.get(RouteModel, "user")` returns
  that route's unit with `outputs.opened`/`params`/`search`/`provided` as
  `Option` ports, narrowed to THAT route's schemas.

## Page data: a model gated on route ports

```ts
class UserPageModel extends Model.Service<UserPageModel>()("app/UserPage")({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(RouteModel, "user");
      const user = yield* Query.make({
        stores: { params: unit.outputs.params },
        handler: ({ params }) =>
          Option.isNone(params)
            ? Effect.fail("closed" as const)
            : fetchUser(params.value.id), // id: number — decoded by the schema
      });
      return { inputs: {}, outputs: {}, ui: { user: user.state } };
    }),
}) {}
```

Entering `/users/1` loads; changing the id reloads; leaving fails the query
into `"closed"`. No loader, no cache options — the model owns its data.

## React: one meeting point

```tsx
import { Link, RouterView } from "@unitflow/router/react";

const UserPage = View.make(UserPageModel, ({ user }) => /* AsyncResult → JSX */);

export const AppView = RouterView.make(NavigationModel, {
  routes: {
    home: ({ children }) => (
      <main>
        <nav>
          {/* to/params/search typed against the registered router */}
          <Link to="/users/:id" params={{ id: 1 }} search={{ page: 1 }}>Ada</Link>
        </nav>
        {children}
      </main>
    ),
    user: UserPage, // a View.make component IS its own entry
  },
  notFound: () => <div>404</div>,
});

// main.tsx — the view carries its root model
const layer = AppView.model.layer.pipe(
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(RouteModel.layer),
  Layer.provideMerge(NavigationModel.layer),
  Layer.provideMerge(Router.browserHistoryLayer), // or memoryHistoryLayer in tests
);

<Unitflow runtime={UnitflowRuntime.make(layer)} rootModel={AppView.model}>
  {(pages) => <AppView unit={pages} />}
</Unitflow>;
```

## Middleware: guards as services

```ts
class AuthGuard extends Router.Middleware<AuthGuard>()("app/AuthGuard")<{
  readonly user: User;
}>() {}

const AuthGuardLive = AuthGuard.make((ctx) =>
  Effect.gen(function* () {
    const session = yield* SessionService; // the GUARD's dependency, not the router's
    if (Option.isNone(session.user)) {
      return yield* Effect.fail(new Router.RedirectError({ options: { to: "/login" } }));
    }
    return { user: session.user.value }; // Provides
  }),
);

const adminRoutes = Router.group(Dashboard, Users).middleware(AuthGuard);
```

Guards run BEFORE a navigation commits: a blocked URL never flashes. The
returned value lands typed in the route unit's `provided` port —
`Option.some` whenever the route is open, because the guard passing is what
let it open.

## Complex search params

Schemas own the URL: literal unions, optional keys, and whole objects
(JSON-encoded into one param) decode into typed ports and encode back
through `Link`/`navigate`/`buildHref`.

```ts
const search = Schema.Struct({
  sort: Schema.Literals(["asc", "desc"]),
  filter: Schema.fromJsonString(Schema.Struct({ role: Schema.String })),
  q: Schema.optionalKey(Schema.String),
});
```

## History is a capability

`Router.make` declares routes only; the environment decides how locations
are read and written: `Router.browserHistoryLayer`,
`Router.hashHistoryLayer`, or `Router.memoryHistoryLayer({ initialEntries })`
in tests. Forgetting one is a compile error, not a silent default.
