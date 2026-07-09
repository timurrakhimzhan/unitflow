// Compile-checked snippets for the "Router: Models" doc page.

// #region unit
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Event, Model, Query, Registry, Store } from "@unitflow/core";
import { Route, Router } from "@unitflow/router";
import { AppRouter } from "./routes";

const program = Effect.gen(function* () {
  const unit = yield* Model.get(AppRouter.routeModel, "user");

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
// #endregion unit

// #region page-model
interface User {
  readonly id: number;
  readonly name: string;
}
declare const fetchUser: (id: number) => Effect.Effect<User, "not found">;

export class UserPageModel extends Model.Service<UserPageModel>()("docs/UserPage")({
  make: () =>
    Effect.gen(function* () {
      const unit = yield* Model.get(AppRouter.routeModel, "user");
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
// #endregion page-model

// #region navigate
const goToUser = Effect.gen(function* () {
  const nav = yield* Model.get(AppRouter.model);

  yield* Event.emit(nav.inputs.navigate, {
    to: "/users/:id",
    params: { id: 42 }, // number: encoded by the schema on the way out
  });

  // navigation is an event; when a program needs the result, wait on state
  yield* Store.waitFor(nav.outputs.state, (state) => state.status !== "pending");
  const location = yield* Store.get(nav.outputs.location);
  void location.pathname; // "/users/42"
});
// #endregion navigate

// #region href
const shareLink = Effect.gen(function* () {
  const href = yield* AppRouter.model.buildHref({
    to: "/users",
    search: { page: 2, sort: "desc", filter: { role: "admin" } },
  });
  void href; // "/users?filter=%7B%22role%22%3A%22admin%22%7D&page=2&sort=desc"
});
// #endregion href

// #region nested-recipe
// AppRouter's table declares ProjectRoute.pipe(Route.addChild(EditRoute)) —
// see routes.ts. The edit view leases ProjectPageModel (Model.get, a shared
// singleton) for data already loaded by the parent, instead of duplicating
// the fetch or threading routing logic through either model.
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

export class ProjectEditModel extends Model.Service<ProjectEditModel>()("docs/ProjectEdit")({
  make: () =>
    Effect.gen(function* () {
      // ProjectEditModel never touches the route directly — it only reads
      // ProjectPageModel's already-loaded data.
      const project = yield* Model.get(ProjectPageModel);
      return { inputs: {}, outputs: {}, ui: { params: project.outputs.params } };
    }),
}) {}
// #endregion nested-recipe

// #region make-model
// Same as UserPageModel above — Model.get + Query, gated on "closed" — but
// params/search/provided arrive unwrapped: no Option.isNone anywhere.
export const UserPageModel2 = Route.makeModel(AppRouter.routeModel, "user", {
  make: ({ params }) => fetchUser(params.id),
});
// #endregion make-model

// #region layers
import * as Layer from "effect/Layer";

// Tests drive the router with an in-memory history:
const testLayer = AppRouter.layer.pipe(
  Layer.provideMerge(Router.memoryHistoryLayer({ initialEntries: ["/users/7"] })),
  Layer.provideMerge(Registry.layer),
);

export const test = Effect.provide(
  Effect.all([program, goToUser, shareLink]),
  testLayer,
);
// #endregion layers
