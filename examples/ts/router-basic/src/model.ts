import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Model, Query } from "@unitflow/react";
import { UsersApi } from "./api";
import { AppRouter } from "./routes";

/** Loads the directory while `/users` is on screen. The route unit's
 * `opened` port is the query's only dependency: navigating away fails the
 * query into "closed", coming back reloads. */
export class UsersPageModel extends Model.Service<UsersPageModel>()(
  "@unitflow/example/router-basic/UsersPage",
)({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(AppRouter.routes, "users");
      const list = yield* Query.make({
        stores: { opened: unit.outputs.opened },
        handler: ({ opened }) =>
          opened
            ? Effect.gen(function* () {
                const api = yield* UsersApi;
                return yield* api.list();
              })
            : Effect.fail("closed" as const),
      });
      return {
        inputs: {},
        outputs: { list: list.state },
        ui: { list: list.state, reload: list.refresh },
      };
    }),
}) {}

/** Loads one user while `/users/:id` is on screen. `params` arrives already
 * decoded (`id: number`) and narrowed to THIS route's schema — changing the
 * id in the URL re-runs the query automatically. */
export class UserPageModel extends Model.Service<UserPageModel>()(
  "@unitflow/example/router-basic/UserPage",
)({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(AppRouter.routes, "user");
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
        ui: { user: user.state, search: unit.outputs.search },
      };
    }),
}) {}

/** The root: owns the router and the page models, republishing their units
 * through `ui` — views never summon instances themselves. */
export class AppModel extends Model.Service<AppModel>()(
  "@unitflow/example/router-basic/App",
)({
  make: () =>
    Effect.gen(function* () {
      const router = yield* Model.get(AppRouter);
      const usersPage = yield* Model.get(UsersPageModel);
      const userPage = yield* Model.get(UserPageModel);
      return {
        inputs: {},
        outputs: {},
        ui: { router, usersPage, userPage },
      };
    }),
}) {}
