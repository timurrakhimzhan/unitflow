import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Model, Query } from "@unitflow/react";
import { Route, Router } from "@unitflow/router";
import { UsersApi } from "./api";

const userParams = Schema.Struct({ id: Schema.NumberFromString });
const userSearch = Schema.Struct({ page: Schema.NumberFromString });
/** An OBJECT inside the query string: one JSON-encoded param. */
const usersFilter = Schema.Struct({ role: Schema.String });
const usersSearch = Schema.Struct({
  filter: Schema.optionalKey(Schema.fromJsonString(usersFilter)),
});

/** Routes declare paths and codecs only. */
export const HomeRoute = Route.make("home", { path: "/" });
/** `path` is relative to `UsersRoute` below — `Route.addChild` joins it: the
 * declared table ends up with `/users/:id`, not `/:id`. */
export const UserRoute = Route.make("user", {
  path: "/:id",
  params: userParams,
  search: userSearch,
});
/** `/users/:id` is a real child PAGE of `/users` — declared explicitly via
 * `addChild`, never inferred from the shared path prefix. */
export const UsersRoute = Route.make("users", { path: "/users", search: usersSearch }).pipe(
  Route.addChild(UserRoute),
);

/** Router.make births the whole AppRouter at once; the app only names it. */
export const AppRouter = Router.make(
  "@unitflow/example/router-basic/router",
  Route.group(HomeRoute, UsersRoute),
);

declare module "@unitflow/router" {
  interface Register {
    readonly router: typeof AppRouter.model;
  }
}

/** Loads the directory while `/users` is on screen: the query's only
 * dependency is the route unit's `opened` port. */
export class UsersPageModel extends Model.Service<UsersPageModel>()(
  "@unitflow/example/router-basic/UsersPage",
)({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(AppRouter.routeModel, "users");
      const list = yield* Query.make({
        // The decoded search object is a plain dependency: changing
        // ?filter={"role":...} re-runs the query.
        stores: { opened: unit.outputs.opened, search: unit.outputs.search },
        handler: ({ opened, search }) =>
          opened
            ? Effect.gen(function* () {
                const api = yield* UsersApi;
                const users = yield* api.list();
                const role = Option.flatMapNullishOr(search, (s) => s.filter?.role);
                return Option.isNone(role)
                  ? users
                  : users.filter((user) => user.role === role.value);
              })
            : Effect.fail("closed" as const),
      });
      return {
        inputs: {},
        outputs: { list: list.state },
        ui: { list: list.state, search: unit.outputs.search, reload: list.refresh },
      };
    }),
}) {}

/** Loads one user while `/users/:id` is on screen. `params` arrives decoded
 * (`id: number`) — changing the id re-runs the query automatically. */
export class UserPageModel extends Model.Service<UserPageModel>()(
  "@unitflow/example/router-basic/UserPage",
)({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(AppRouter.routeModel, "user");
      const user = yield* Query.make({
        stores: { params: unit.outputs.params },
        handler: ({ params }) =>
          Option.isNone(params)
            ? Effect.fail("closed" as const)
            : Effect.gen(function* () {
                const api = yield* UsersApi;
                return yield* api.get(params.value.id);
              }),
      });
      return {
        inputs: {},
        outputs: { user: user.state },
        ui: { user: user.state, params: unit.outputs.params, search: unit.outputs.search },
      };
    }),
}) {}

