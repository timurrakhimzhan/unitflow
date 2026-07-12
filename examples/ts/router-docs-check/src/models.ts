// Compile-checked snippets for the "Router: Models" doc page.

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Event, Model, Registry, Store } from "@unitflow/core";
import { Route, Router } from "@unitflow/router";
import { AppRouter, UserLoader, UserRoute, userParams, type User } from "./routes";

// #region loader
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
// #endregion loader

// #region page-model
export class UserPageModel extends Model.Service<UserPageModel>()(
  "docs/UserPage",
)<Route.Output<typeof UserRoute>>()({
  make: ({ user }) =>
    Effect.gen(function* () {
      const profile = Store.make(user);
      const rename = yield* Event.input<string>().pipe(
        Event.handler((name) => Store.update(profile, (current) => ({ ...current, name }))),
      );
      return {
        inputs: { rename },
        outputs: { profile },
        ui: { profile, rename },
      };
    }),
}) {}
// #endregion page-model

// #region route-state
/** Direct route units are for long-lived observers outside the matched page,
 * such as breadcrumbs or analytics. Page models receive middleware output
 * directly, as UserPageModel does above. */
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
// #endregion route-state

// #region navigation-model
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
// #endregion navigation-model

// #region layers
import * as Layer from "effect/Layer";

// Tests replace browser history without changing the router or page model.
export const testLayer = NavigationModel.layer.pipe(
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(AppRouter.layer),
  Layer.provideMerge(UserLoaderLive),
  Layer.provideMerge(Router.memoryHistoryLayer({ initialEntries: ["/users/7"] })),
  Layer.provideMerge(Registry.layer),
);
// #endregion layers
