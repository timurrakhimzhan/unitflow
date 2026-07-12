import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Model, Store } from "@unitflow/react";
import { Route, Router } from "@unitflow/router";
import { UsersApi, type User } from "./api";

const userParams = Schema.Struct({ id: Schema.NumberFromString });
const userSearch = Schema.Struct({ page: Schema.NumberFromString });
const usersFilter = Schema.Struct({ role: Schema.String });
const usersSearch = Schema.Struct({
  filter: Schema.optionalKey(Schema.fromJsonString(usersFilter)),
});

export class UsersLoader extends Router.Middleware<UsersLoader>()(
  "@unitflow/example/router-basic/UsersLoader",
)<{
  readonly users: ReadonlyArray<User>;
  readonly search: Schema.Schema.Type<typeof usersSearch>;
}>() {}

export class UserLoader extends Router.Middleware<UserLoader>()(
  "@unitflow/example/router-basic/UserLoader",
)<{
  readonly user: User;
  readonly params: Schema.Schema.Type<typeof userParams>;
  readonly search: Schema.Schema.Type<typeof userSearch>;
}>() {}

export const HomeRoute = Route.make("home", { path: "/" });
export const UserRoute = Route.make("user", {
  path: "/:id",
  params: userParams,
  search: userSearch,
}).pipe(Route.middleware(UserLoader));
export const UsersRoute = Route.make("users", {
  path: "/users",
  search: usersSearch,
}).pipe(Route.middleware(UsersLoader), Route.addChild(UserRoute));

export const AppRouter = Router.make(
  "@unitflow/example/router-basic/router",
  Route.group(HomeRoute, UsersRoute),
);

declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof AppRouter.model;
  }
}

/** The list is loaded before /users commits. The decoded search value is
 * returned with the data, becoming the page model's exact construction key. */
export const UsersLoaderLive = UsersLoader.layer((context) =>
  Effect.gen(function* () {
    if (!Schema.is(usersSearch)(context.search)) {
      return yield* Effect.fail(new Router.NotFoundError({}));
    }
    const api = yield* UsersApi;
    const users = yield* api.list();
    const role = context.search.filter?.role;
    return {
      users: role === undefined ? users : users.filter((user) => user.role === role),
      search: context.search,
    };
  }),
);

/** The detail resource is also resolved before commit. An API miss becomes a
 * router not-found result instead of a page model's synthetic "closed" state. */
export const UserLoaderLive = UserLoader.layer((context) => {
  const params = context.params;
  const search = context.search;
  if (!Schema.is(userParams)(params) || !Schema.is(userSearch)(search)) {
    return Effect.fail(new Router.NotFoundError({}));
  }
  return Effect.gen(function* () {
    const api = yield* UsersApi;
    const user = yield* api.get(params.id).pipe(
      Effect.mapError(() => new Router.NotFoundError({})),
    );
    return { user, params, search };
  });
});

export class UsersPageModel extends Model.Service<UsersPageModel>()(
  "@unitflow/example/router-basic/UsersPage",
)<Route.Output<typeof UsersRoute>>()({
  make: ({ users, search }) =>
    Effect.gen(function* () {
      const list = Store.make(users);
      const routeSearch = Store.make(search);
      return {
        inputs: {},
        outputs: { list, search: routeSearch },
        ui: { list, search: routeSearch },
      };
    }),
}) {}

export class UserPageModel extends Model.Service<UserPageModel>()(
  "@unitflow/example/router-basic/UserPage",
)<Route.Output<typeof UserRoute>>()({
  make: ({ user, params, search }) =>
    Effect.gen(function* () {
      const profile = Store.make(user);
      const routeParams = Store.make(params);
      const routeSearch = Store.make(search);
      return {
        inputs: {},
        outputs: { profile },
        ui: { profile, params: routeParams, search: routeSearch },
      };
    }),
}) {}
