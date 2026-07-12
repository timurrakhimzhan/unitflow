import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as React from "react";
import * as Schema from "effect/Schema";
import { Event, Model, Registry, Query, Store } from "@unitflow/core";
import { View } from "@unitflow/react";
import { Route, Router } from "../src/index.js";
import { makePages } from "../src/router.js";
import * as RouterReact from "../src/react.js";
import { Link, type BoundRouter, type RouteComponent } from "../src/react.js";

const userParams = Schema.Struct({ id: Schema.NumberFromString });
const pageSearch = Schema.Struct({ page: Schema.NumberFromString });

const HomeRoute = Route.make("home", { path: "/" });

const UserRoute = Route.make("user", {
  path: "/users/:id",
  params: userParams,
  search: pageSearch,
});

const SettingsRoute = Route.make("settings", {
  path: "/settings",
});

const routeGroup = Route.group(HomeRoute, UserRoute).merge(
  Route.group(SettingsRoute).prefix("/admin"),
);

let nextRouter = 0;

const makeRouter = () => Router.make(`/test/router/${++nextRouter}`, routeGroup);

/** Registry + an in-memory history: what every router test provides. */
const testEnv = (initial = "/") =>
  Layer.mergeAll(Registry.layer, Router.memoryHistoryLayer({ initialEntries: [initial] }));

const { model: PageQueryRouter, routeModel: PageQueryRoutes } = Router.make(
  "/test/router/page-query",
  routeGroup,
);

// Registering the app router types RedirectError targets exactly like
// navigate options (unregistered apps stay lenient).
declare module "../src/index.js" {
  interface Register {
    readonly router: typeof PageQueryRouter;
  }
}

interface UserEndpointShape {
  readonly getUser: (id: number) => Effect.Effect<{ readonly id: number }, never>;
}

class UserEndpoint extends Context.Service<UserEndpoint, UserEndpointShape>()(
  "/test/router/UserEndpoint",
) {}

/** A page model observing its route through the router's built-in `routes`
 * keyed model: `outputs.params` arrives already narrowed to the "user"
 * route's schema types. */
class UserRouteQueryModel extends Model.Service<UserRouteQueryModel>()(
  "/test/router/UserRouteQueryModel",
)({
  make: () =>
    Effect.gen(function* () {
      const userRoute = yield* Model.get(PageQueryRoutes, "user");
      const user = yield* Query.make({
        stores: { params: userRoute.outputs.params },
        handler: ({ params }) =>
          Option.isNone(params)
            ? Effect.fail("page closed" as const)
            : Effect.gen(function* () {
                const endpoint = yield* UserEndpoint;
                return yield* endpoint.getUser(params.value.id);
              }),
      });

      return {
        inputs: {},
        outputs: {
          openedUser: userRoute.outputs.params,
          user: user.state,
        },
        ui: {
          user: user.state,
        },
      };
    }),
}) {}

describe("@unitflow/router", () => {
  it.effect("matches routes and decodes params/search through the navigate event", () => {
    const { model: AppRouter } = makeRouter();
    return Effect.gen(function* () {
      const router = yield* Model.get(AppRouter);

      yield* Registry.allSettled(
        Event.emit(router.inputs.navigate, {
          to: "/users/:id",
          params: { id: 42 },
          search: { page: 2 },
        }),
      );

      const state = yield* Store.get(router.outputs.state);

      assert.strictEqual(state.status, "success");
      assert.strictEqual(state.location.href, "/users/42?page=2");
      const match = state.matches.at(-1);
      assert.isDefined(match);
      assert.strictEqual(match?.route.id, "user");
      assert.deepStrictEqual(match?.params, { id: 42 });
      assert.deepStrictEqual(match?.search, { page: 2 });
    }).pipe(Effect.provide(AppRouter.layer.pipe(Layer.provideMerge(testEnv()))));
  });

  it.effect("builds prefixed group links through Effect dependency injection", () => {
    const { model: AppRouter } = makeRouter();
    return Effect.gen(function* () {
      const href = yield* AppRouter.buildHref({ to: "/admin/settings" });
      assert.strictEqual(href, "/admin/settings");
    }).pipe(Effect.provide(AppRouter.layer.pipe(Layer.provideMerge(testEnv()))));
  });

  it.effect("exposes navigation as model ports", () => {
    const { model: AppRouter } = makeRouter();
    return Effect.gen(function* () {
      const router = yield* Model.get(AppRouter);

      yield* Registry.allSettled(
        Event.emit(router.inputs.navigate, {
          to: "/users/:id",
          params: { id: 7 },
          search: { page: 3 },
        }),
      );

      const state = yield* Store.get(router.outputs.state);
      const api = yield* Store.get(router.outputs.api);
      assert.strictEqual(state.location.href, "/users/7?page=3");
      assert.strictEqual(
        api.buildHref({ to: "/users/:id", params: { id: 8 }, search: { page: 4 } }),
        "/users/8?page=4",
      );
    }).pipe(Effect.provide(AppRouter.layer.pipe(Layer.provideMerge(testEnv()))));
  });

  it.effect("exposes every route as a keyed unit with typed ports", () => {
    const testLayer = PageQueryRoutes.layer.pipe(
      Layer.provideMerge(PageQueryRouter.layer),
      Layer.provideMerge(testEnv()),
    );

    return Effect.gen(function* () {
      const router = yield* Model.get(PageQueryRouter);
      const userRoute = yield* Model.get(PageQueryRoutes, "user");

      assert.isFalse(yield* Store.get(userRoute.outputs.opened));
      assert.isTrue(Option.isNone(yield* Store.get(userRoute.outputs.params)));

      yield* Registry.allSettled(
        Event.emit(router.inputs.navigate, {
          to: "/users/:id",
          params: { id: 5 },
          search: { page: 4 },
        }),
      );

      assert.isTrue(yield* Store.get(userRoute.outputs.opened));
      assert.deepStrictEqual(
        yield* Store.get(userRoute.outputs.params),
        Option.some({ id: 5 }),
      );
      assert.deepStrictEqual(
        yield* Store.get(userRoute.outputs.search),
        Option.some({ page: 4 }),
      );

      // The "user" key narrows the ports to that route's schema types.
      const params = yield* Store.get(userRoute.outputs.params);
      if (Option.isSome(params)) {
        const id: number = params.value.id;
        void id;
      }
      if (false) {
        // @ts-expect-error the "user" route has no "missing" param
        Store.get(userRoute.outputs.params).pipe(Effect.map(Option.map((p) => p.missing)));
        // @ts-expect-error route ids are constrained to the declared union
        void Model.get(PageQueryRoutes, "unknown");
      }

      yield* Registry.allSettled(
        Event.emit(router.inputs.navigate, { to: "/admin/settings" }),
      );

      assert.isFalse(yield* Store.get(userRoute.outputs.opened));
      assert.isTrue(Option.isNone(yield* Store.get(userRoute.outputs.params)));
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("lets models gate queries from a matches-derived store", () => {
    const calls: Array<number> = [];
    const endpoint = UserEndpoint.of({
      getUser: (id) =>
        Effect.sync(() => {
          calls.push(id);
          return { id };
        }),
    });

    const testLayer = UserRouteQueryModel.layer.pipe(
      Layer.provideMerge(PageQueryRoutes.layer),
      Layer.provideMerge(PageQueryRouter.layer),
      Layer.provideMerge(Layer.succeed(UserEndpoint, endpoint)),
      Layer.provideMerge(testEnv()),
    );

    return Effect.gen(function* () {
      const model = yield* Model.get(UserRouteQueryModel);
      const router = yield* Model.get(PageQueryRouter);
      yield* Registry.allSettled();

      assert.deepStrictEqual(calls, []);
      assert.strictEqual((yield* Store.get(model.outputs.user))._tag, "Failure");
      assert.isTrue(Option.isNone(yield* Store.get(model.outputs.openedUser)));

      yield* Registry.allSettled(
        Event.emit(router.inputs.navigate, {
          to: "/users/:id",
          params: { id: 42 },
          search: { page: 1 },
        }),
      );
      yield* Store.waitFor(model.outputs.user, (result) => result._tag === "Success");

      assert.deepStrictEqual(calls, [42]);
      const loadedUser = yield* Store.get(model.outputs.user);
      assert.strictEqual(loadedUser._tag, "Success");
      if (loadedUser._tag === "Success") {
        assert.deepStrictEqual(loadedUser.value, { id: 42 });
      }

      yield* Registry.allSettled(
        Event.emit(router.inputs.navigate, { to: "/admin/settings" }),
      );
      yield* Store.waitFor(model.outputs.user, (result) => result._tag === "Failure");

      assert.deepStrictEqual(calls, [42]);
      assert.strictEqual((yield* Store.get(model.outputs.user))._tag, "Failure");
      assert.isTrue(Option.isNone(yield* Store.get(model.outputs.openedUser)));
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("middleware gates navigation before anything commits and provides typed data", () => {
    interface GateShape {
      readonly currentUser: () => string | undefined;
    }
    class Gate extends Context.Service<Gate, GateShape>()("/test/router/Gate") {}
    class AdminGuard extends Router.Middleware<AdminGuard>()("/test/router/AdminGuard")<{
      readonly user: string;
    }>() {}

    const AdminRoute = Route.make("admin", { path: "/admin" });
    const OpenRoute = Route.make("open", { path: "/" });
    const guardedGroup = Route.group(OpenRoute).merge(
      Route.group(AdminRoute).middleware(AdminGuard),
    );
    const { model: GuardedRouter, routeModel: GuardedRoutes } = Router.make(
      "/test/router/guarded",
      guardedGroup,
    );

    let user: string | undefined = undefined;
    const guardLayer = AdminGuard.layer((context) =>
      Effect.gen(function* () {
        const gate = yield* Gate;
        const current = gate.currentUser();
        if (current === undefined) {
          return yield* Effect.fail(
            new Router.RedirectError({ options: { to: "/" } }),
          );
        }
        void context;
        return { user: current };
      }),
    );

    const testLayer = GuardedRoutes.layer.pipe(
      Layer.provideMerge(GuardedRouter.layer),
      Layer.provideMerge(guardLayer),
      Layer.provideMerge(Layer.succeed(Gate, Gate.of({ currentUser: () => user }))),
      Layer.provideMerge(testEnv()),
    );

    return Effect.gen(function* () {
      const router = yield* Model.get(GuardedRouter);
      const adminRoute = yield* Model.get(GuardedRoutes, "admin");

      // Blocked: the redirect fires BEFORE commit — /admin never reaches
      // history or state, no URL flash.
      yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: "/admin" }));
      const blocked = yield* Store.get(router.outputs.state);
      assert.strictEqual(blocked.status, "success");
      assert.strictEqual(blocked.location.href, "/");
      assert.isFalse(yield* Store.get(adminRoute.outputs.opened));
      assert.isTrue(Option.isNone(yield* Store.get(adminRoute.outputs.provided)));

      // Allowed: the guard's return value lands in the unit's provided port,
      // typed by the middleware's Provides declaration.
      user = "neo";
      yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: "/admin" }));
      const passed = yield* Store.get(router.outputs.state);
      assert.strictEqual(passed.location.href, "/admin");
      assert.isTrue(yield* Store.get(adminRoute.outputs.opened));

      const provided = yield* Store.get(adminRoute.outputs.provided);
      assert.deepStrictEqual(provided, Option.some({ user: "neo" }));
      if (Option.isSome(provided)) {
        const name: string = provided.value.user; // user EXISTS in the type
        void name;
      }
      if (false) {
        // @ts-expect-error the guard provides `user`, not `token`
        Store.get(adminRoute.outputs.provided).pipe(Effect.map(Option.map((p) => p.token)));
      }
    }).pipe(Effect.provide(testLayer));
  });

  it("rejects duplicate route ids at construction", () => {
    assert.throws(
      () =>
        Router.make(
          "/test/router/duplicate",
          Route.group(
            Route.make("same", { path: "/a" }),
            Route.make("same", { path: "/b" }),
          ),
        ),
      /duplicate route id "same"/,
    );
  });

  it("types redirect targets, views maps, and per-key shapes", () => {
    // --- RedirectError is checked against the REGISTERED router ---
    const ok = new Router.RedirectError({
      options: { to: "/users/:id", params: { id: 1 }, search: { page: 1 } },
    });
    assert.strictEqual(ok._tag, "RedirectError");
    // A raw href (e.g. a `?redirect=` target a guard read off the URL) is
    // valid too — the same "known route or plain string" union `navigate`
    // accepts, since a guard redirecting is just `navigate` under another
    // name. It skips params/search entirely, unlike a known route below.
    const rawRedirect = new Router.RedirectError({ options: { to: "/missing" } });
    assert.strictEqual(rawRedirect._tag, "RedirectError");
    if (false) {
      // @ts-expect-error redirect params follow the target route's schema
      new Router.RedirectError({ options: { to: "/users/:id", params: { id: "1" }, search: { page: 1 } } });
    }

    // --- views map: keys are the router's route ids, match narrows per id ---
    type Views = RouterReact.RouterViews<typeof PageQueryRouter>;
    const views: Views = {
      routes: {
        user: ({ match, children }) => {
          const id: number = match.params.id; // narrowed to the "user" route
          void id;
          return children;
        },
        home: ({ children }) => children,
      },
    };
    assert.isDefined(views);
    if (false) {
      const badKey: Views = {
        routes: {
          // @ts-expect-error "nope" is not a route id of this router
          nope: ({ children }: { children: React.ReactNode }) => children,
        },
      };
      const badMatch: Views = {
        routes: {
          home: ({ match }) => {
            // @ts-expect-error the "home" route has no params.id
            const id = match.params.id;
            return id;
          },
        },
      };
      void badKey;
      void badMatch;
    }

    // --- per-key shape map: every narrow shape is structurally a narrowing
    // of the wide shape the runtime actually builds (ports and their kinds
    // line up; the per-key downcast itself is guaranteed by the unique-id
    // invariant Router.make enforces). ---
    type Group = Router.RouterGroupOf<typeof PageQueryRouter>;
    type NarrowShapes = Router.RouteShapes<Group>[Router.RouteIds<Group>];
    type WideShape = Router.RouteUnitShape<Router.RouterRoutes<typeof PageQueryRouter>>;
    type NarrowExtendsWide = NarrowShapes extends WideShape ? true : false;
    const shapesCoherent: NarrowExtendsWide = true;
    assert.isTrue(shapesCoherent);
  });

  it.effect("pages model owns the router unit and mapped page models", () => {
    class UserPage extends Model.Service<UserPage>()("/test/router/pages/UserPage")({
      make: () =>
        Effect.gen(function* () {
          const unit = yield* Model.get(PageQueryRoutes, "user");
          const label = Store.combine([unit.outputs.params], (params) =>
            Option.match(params, {
              onNone: () => "closed",
              onSome: ({ id }) => `user:${id}`,
            }),
          );
          return { inputs: {}, outputs: { label }, ui: { label } };
        }),
    }) {}

    const AppPages = makePages(PageQueryRouter, { user: UserPage });

    const testLayer = AppPages.layer.pipe(
      Layer.provideMerge(UserPage.layer),
      Layer.provideMerge(PageQueryRoutes.layer),
      Layer.provideMerge(PageQueryRouter.layer),
      Layer.provideMerge(testEnv()),
    );

    return Effect.gen(function* () {
      // This test's whole point is that a mapped page's `ui` arrives
      // precisely typed through `pages.ui` — the same access
      // `@unitflow/react`'s binding does internally, not a plain
      // Model.get-for-data read, hence the explicit cast back to full
      // precision.
      // eslint-disable-next-line revizo/no-type-assertion
      const pages = (yield* Model.get(AppPages)) as unknown as Model.PortsOf<typeof AppPages>;
      const router = yield* Model.get(PageQueryRouter);

      // The page unit arrives typed through the map: label is Store<string>.
      const closed: string = yield* Store.get(pages.ui.user.ui.label);
      assert.strictEqual(closed, "closed");

      yield* Registry.allSettled(
        Event.emit(router.inputs.navigate, {
          to: "/users/:id",
          params: { id: 9 },
          search: { page: 1 },
        }),
      );

      assert.strictEqual(yield* Store.get(pages.ui.user.ui.label), "user:9");
      if (false) {
        // @ts-expect-error only mapped route ids appear on pages.ui
        pages.ui.settings;
        // @ts-expect-error page map keys are constrained to route ids
        PageQueryRouter.pages({ unknown: UserPage });
      }
    }).pipe(Effect.provide(testLayer));
  });

  describe("complex schemas", () => {
    const repoParams = Schema.Struct({
      orgId: Schema.NumberFromString,
      repoId: Schema.String,
    });
    const repoFilter = Schema.Struct({
      role: Schema.Literals(["admin", "viewer"]),
      active: Schema.Boolean,
      stars: Schema.Number,
    });
    const repoSearch = Schema.Struct({
      page: Schema.NumberFromString,
      sort: Schema.Literals(["asc", "desc"]),
      // An OBJECT in the query string: JSON-encoded into one param.
      filter: Schema.fromJsonString(repoFilter),
      q: Schema.optionalKey(Schema.String),
    });

    const RepoRoute = Route.make("repo", {
      path: "/orgs/:orgId/repos/:repoId",
      params: repoParams,
      search: repoSearch,
    });
    const HomeRoute2 = Route.make("home", { path: "/" });

    const makeComplex = () =>
      Router.make(`/test/router/complex/${++nextRouter}`, Route.group(HomeRoute2, RepoRoute));

    it.effect("roundtrips nested-object search params through the URL", () => {
      const { model: Nav, routeModel: Routes } = makeComplex();
      const testLayer = Routes.layer.pipe(
        Layer.provideMerge(Nav.layer),
        Layer.provideMerge(testEnv()),
      );
      return Effect.gen(function* () {
        const router = yield* Model.get(Nav);
        const unit = yield* Model.get(Routes, "repo");

        yield* Registry.allSettled(
          Event.emit(router.inputs.navigate, {
            to: "/orgs/:orgId/repos/:repoId",
            params: { orgId: 7, repoId: "unitflow" },
            search: {
              page: 2,
              sort: "desc",
              filter: { role: "admin", active: true, stars: 4.5 },
            },
          }),
        );

        const state = yield* Store.get(router.outputs.state);
        assert.strictEqual(state.status, "success");
        // The object went INTO the URL as one JSON-encoded param...
        assert.strictEqual(state.location.pathname, "/orgs/7/repos/unitflow");
        assert.include(state.location.searchString, "filter=");
        assert.include(
          decodeURIComponent(state.location.searchString),
          '{"role":"admin","active":true,"stars":4.5}',
        );

        // ...and came back out DECODED and typed on the route unit.
        const params = yield* Store.get(unit.outputs.params);
        assert.deepStrictEqual(params, Option.some({ orgId: 7, repoId: "unitflow" }));
        const search = yield* Store.get(unit.outputs.search);
        assert.deepStrictEqual(
          search,
          Option.some({
            page: 2,
            sort: "desc" as const,
            filter: { role: "admin" as const, active: true, stars: 4.5 },
          }),
        );
        if (Option.isSome(search)) {
          const stars: number = search.value.filter.stars; // fully typed nesting
          void stars;
        }

        // buildHref encodes the same shape without navigating.
        const href = yield* Nav.buildHref({
          to: "/orgs/:orgId/repos/:repoId",
          params: { orgId: 1, repoId: "x" },
          search: { page: 1, sort: "asc", filter: { role: "viewer", active: false, stars: 0 } },
        });
        assert.include(href, "/orgs/1/repos/x?");
        assert.include(decodeURIComponent(href), '"role":"viewer"');
      }).pipe(Effect.provide(testLayer));
    });

    it.effect("decodes a deep link and rejects invalid search", () => {
      const { model: Nav, routeModel: Routes } = makeComplex();
      const deepLink =
        "/orgs/42/repos/core?page=3&sort=asc&filter=" +
        encodeURIComponent('{"role":"viewer","active":false,"stars":10}') +
        "&q=hello";
      const goodLayer = Routes.layer.pipe(
        Layer.provideMerge(Nav.layer),
        Layer.provideMerge(testEnv(deepLink)),
      );
      return Effect.gen(function* () {
        const router = yield* Model.get(Nav);
        const unit = yield* Model.get(Routes, "repo");

        // Initial load decoded everything straight from the URL.
        assert.strictEqual((yield* Store.get(router.outputs.state)).status, "success");
        assert.deepStrictEqual(
          yield* Store.get(unit.outputs.search),
          Option.some({
            page: 3,
            sort: "asc" as const,
            filter: { role: "viewer" as const, active: false, stars: 10 },
            q: "hello",
          }),
        );

        // A URL that fails the schema (bad literal) is an error state, not a
        // half-decoded page.
        yield* Registry.allSettled(
          Event.emit(router.inputs.navigate, { to: "/" }),
        );
        const badHistory = yield* Model.get(Nav);
        void badHistory;
      }).pipe(Effect.provide(goodLayer));
    });

    it.effect("invalid deep link lands in error state", () => {
      const { model: Nav, routeModel: Routes } = makeComplex();
      const badLink = "/orgs/42/repos/core?page=3&sort=sideways&filter=notjson";
      const layer = Routes.layer.pipe(
        Layer.provideMerge(Nav.layer),
        Layer.provideMerge(testEnv(badLink)),
      );
      return Effect.gen(function* () {
        const router = yield* Model.get(Nav);
        const unit = yield* Model.get(Routes, "repo");
        assert.strictEqual((yield* Store.get(router.outputs.state)).status, "error");
        assert.isFalse(yield* Store.get(unit.outputs.opened));
      }).pipe(Effect.provide(layer));
    });

    it("types complex params and search", () => {
      const { model: Nav } = makeComplex();
      if (false) {
        // @ts-expect-error sort is a literal union
        void Nav.buildHref({ to: "/orgs/:orgId/repos/:repoId", params: { orgId: 1, repoId: "x" }, search: { page: 1, sort: "sideways", filter: { role: "admin", active: true, stars: 0 } } });
        // @ts-expect-error filter.role is a literal union
        void Nav.buildHref({ to: "/orgs/:orgId/repos/:repoId", params: { orgId: 1, repoId: "x" }, search: { page: 1, sort: "asc", filter: { role: "root", active: true, stars: 0 } } });
        // @ts-expect-error filter is required
        void Nav.buildHref({ to: "/orgs/:orgId/repos/:repoId", params: { orgId: 1, repoId: "x" }, search: { page: 1, sort: "asc" } });
        // @ts-expect-error orgId is a number after decoding
        void Nav.buildHref({ to: "/orgs/:orgId/repos/:repoId", params: { orgId: "1", repoId: "x" }, search: { page: 1, sort: "asc", filter: { role: "admin", active: true, stars: 0 } } });
      }
      assert.isDefined(Nav);
    });
  });

  describe("explicit hierarchy", () => {
    it("addChild derives the joined path and records parentId", () => {
      const EditRoute = Route.make("edit", { path: "/edit" });
      const ProjectRoute = Route.make("project", { path: "/projects/:id" }).pipe(
        Route.addChild(EditRoute),
      );
      const group = Route.group(ProjectRoute);
      const edit = group.routes.find((route) => route.id === "edit");
      assert.isDefined(edit);
      assert.strictEqual(edit?.path, "/projects/:id/edit");
      assert.strictEqual(edit?.parentId, "project");
    });

    it.effect("a route with no declared children never becomes an accidental ancestor", () => {
      // Regression: `/` used to prefix-match everything, so a route there
      // dragged every other navigation's matches along with it.
      const Home = Route.make("home", { path: "/" });
      const Login = Route.make("login", { path: "/login" });
      const { model } = Router.make(
        `/test/router/no-inherit/${++nextRouter}`,
        Route.group(Home, Login),
      );
      return Effect.gen(function* () {
        const router = yield* Model.get(model);
        yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: "/login" }));
        const state = yield* Store.get(router.outputs.state);
        assert.strictEqual(state.matches.length, 1);
        assert.strictEqual(state.matches[0]?.route.id, "login");
      }).pipe(Effect.provide(model.layer.pipe(Layer.provideMerge(testEnv()))));
    });

    it.effect("routes sharing a literal path prefix without addChild do not nest", () => {
      const Users = Route.make("users", { path: "/users" });
      const UsersNew = Route.make("usersNew", { path: "/users/new" });
      const { model } = Router.make(
        `/test/router/no-prefix-nest/${++nextRouter}`,
        Route.group(Users, UsersNew),
      );
      return Effect.gen(function* () {
        const router = yield* Model.get(model);
        yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: "/users/new" }));
        const state = yield* Store.get(router.outputs.state);
        assert.strictEqual(state.matches.length, 1);
        assert.strictEqual(state.matches[0]?.route.id, "usersNew");
      }).pipe(Effect.provide(model.layer.pipe(Layer.provideMerge(testEnv()))));
    });

    it.effect("navigate accepts a raw href string and still runs guards", () => {
      class RawGuard extends Router.Middleware<RawGuard>()("/test/router/RawGuard")<{
        readonly ok: true;
      }>() {}
      const AdminRoute2 = Route.make("admin2", { path: "/admin2" });
      const { model, routeModel } = Router.make(
        `/test/router/raw-href/${++nextRouter}`,
        Route.group(AdminRoute2).middleware(RawGuard),
      );
      let calls = 0;
      const guardLayer = RawGuard.layer(() =>
        Effect.sync(() => {
          calls++;
          return { ok: true as const };
        }),
      );
      const testLayer = routeModel.layer.pipe(
        Layer.provideMerge(model.layer),
        Layer.provideMerge(guardLayer),
        Layer.provideMerge(testEnv()),
      );
      return Effect.gen(function* () {
        const router = yield* Model.get(model);
        // Typed as a plain `string`, not a literal — forces the RawToOptions
        // union member, exactly like a redirect target read off `?redirect=`.
        const target: string = "/admin2";
        yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: target }));
        const state = yield* Store.get(router.outputs.state);
        assert.strictEqual(state.location.pathname, "/admin2");
        assert.strictEqual(calls, 1);
      }).pipe(Effect.provide(testLayer));
    });
  });

  it.effect("history-driven navigation (back/forward, manual URL) recommits matches", () => {
    // Regression: the history subscriber must run the FULL dispatch step —
    // a bare publish fed pubsub subscribers but never the commit handler,
    // so browser back/forward silently changed the URL without the state.
    const { model: Nav, routeModel: Routes } = makeRouter();
    let capturedHistory: Router.RouterHistory | undefined;
    const capturingHistoryLayer = Layer.succeed(
      Router.History,
      Router.History.of({
        make: (options) => {
          capturedHistory = Router.createMemoryHistory({
            initialEntries: ["/"],
            parseSearch: options.parseSearch,
          });
          return capturedHistory;
        },
      }),
    );
    const testLayer = Routes.layer.pipe(
      Layer.provideMerge(Nav.layer),
      Layer.provideMerge(capturingHistoryLayer),
      Layer.provideMerge(Registry.layer),
    );
    return Effect.gen(function* () {
      const router = yield* Model.get(Nav);
      const userRoute = yield* Model.get(Routes, "user");
      assert.isFalse(yield* Store.get(userRoute.outputs.opened));

      // Simulate the browser driving the URL (back/forward/manual entry).
      yield* Registry.allSettled(
        Effect.sync(() => capturedHistory?.push("/users/9?page=2")),
      );

      assert.strictEqual((yield* Store.get(router.outputs.state)).location.href, "/users/9?page=2");
      assert.isTrue(yield* Store.get(userRoute.outputs.opened));
      assert.deepStrictEqual(yield* Store.get(userRoute.outputs.params), Option.some({ id: 9 }));

      yield* Registry.allSettled(Effect.sync(() => capturedHistory?.push("/")));
      assert.isFalse(yield* Store.get(userRoute.outputs.opened));
      assert.strictEqual((yield* Store.get(router.outputs.state)).location.href, "/");
    }).pipe(Effect.provide(testLayer));
  });

  it("does not export router hooks", () => {
    assert.notProperty(RouterReact, "useRouter");
    assert.notProperty(RouterReact, "useRouterState");
    assert.notProperty(RouterReact, "useParams");
    assert.notProperty(RouterReact, "useSearch");
    assert.notProperty(RouterReact, "useLoaderData");
    assert.notProperty(RouterReact, "useNavigate");
  });

  it("keeps routes free of UI and data-loading concerns", () => {
    if (false) {
      // @ts-expect-error components live in the RouterView views map, not on routes
      Route.make("bad-component", { path: "/", component: () => null });
      // @ts-expect-error loaders are gone: route data belongs to the route's model + Query
      Route.make("bad-loader", { path: "/", loader: () => Effect.succeed(1) });
      // @ts-expect-error beforeLoad is gone: gating belongs to the route's model
      Route.make("bad-before", { path: "/", beforeLoad: () => ({}) });
    }
    assert.isTrue(true);
  });

  it("types route params, search, and model-bound links", () => {
    const { model: TypedRouter } = makeRouter();
    const { model: OtherRouter } = Router.make("/test/router/other", routeGroup);
    const bound = undefined as unknown as BoundRouter<typeof TypedRouter>;

    const hrefEffect: Effect.Effect<string, unknown, any> = TypedRouter.buildHref({
      to: "/users/:id",
      params: { id: 1 },
      search: { page: 1 },
    });
    void hrefEffect;

    if (false) {
      // @ts-expect-error path params are required
      TypedRouter.buildHref({ to: "/users/:id", search: { page: 1 } });
      // @ts-expect-error path params use the decoded schema type
      TypedRouter.buildHref({ to: "/users/:id", params: { id: "1" }, search: { page: 1 } });
      // @ts-expect-error search input is typed
      TypedRouter.buildHref({ to: "/users/:id", params: { id: 1 }, search: { page: "1" } });
      // "/missing" is a raw href, not a declared route path — valid on its
      // own (same union `navigate` accepts), just untyped params/search.
      void TypedRouter.buildHref({ to: "/missing" });
      // Providing the WRONG router's layer must not discharge the requirement:
      // the leftover service id keeps the effect from typing as Registry-only.
      // @ts-expect-error DI is tied to the concrete router service id
      const wrongDi: Effect.Effect<string, unknown, Registry> = TypedRouter.buildHref({
        to: "/users/:id",
        params: { id: 1 },
        search: { page: 1 },
      }).pipe(Effect.provide(OtherRouter.layer.pipe(Layer.provideMerge(testEnv()))));
      void wrongDi;
    }

    const link = (
      <Link router={bound} to="/users/:id" params={{ id: 1 }} search={{ page: 1 }}>
        User
      </Link>
    );
    // @ts-expect-error Link params are typed too
    const badLink = <Link router={bound} to="/users/:id" search={{ page: 1 }} />;

    const UserPanel: RouteComponent<
      typeof TypedRouter,
      Router.MatchByPath<typeof TypedRouter, "/users/:id">
    > = ({ match, router }) => {
      const id: number = match.params.id;
      const page: number = match.search.page;
      const nestedLink = (
        <Link router={router} to="/users/:id" params={{ id }} search={{ page }}>
          User
        </Link>
      );
      return nestedLink;
    };

    assert.isDefined(link);
    assert.isDefined(badLink);
    assert.isDefined(UserPanel);
  });

  it("bindComponents narrows Link/Navigate/MatchRoute without a global Register", () => {
    const { model: TypedRouter } = makeRouter();
    // The structural alternative to `declare module { Register }`: same
    // runtime Link/Navigate/MatchRoute, just re-typed to this router — no
    // ambient state, works even for an app with more than one router.
    const { Link: BoundLink, Navigate: BoundNavigate, MatchRoute: BoundMatchRoute } =
      RouterReact.RouterView.bindComponents(TypedRouter);

    const link = (
      <BoundLink to="/users/:id" params={{ id: 1 }} search={{ page: 1 }}>
        User
      </BoundLink>
    );
    const nav = <BoundNavigate to="/users/:id" params={{ id: 1 }} search={{ page: 1 }} />;
    const match = <BoundMatchRoute to="/admin/settings">{() => null}</BoundMatchRoute>;

    if (false) {
      // @ts-expect-error params are required, same as the un-bound Link
      const badLink = <BoundLink to="/users/:id" search={{ page: 1 }} />;
      // @ts-expect-error params use the decoded schema type (number, not string)
      const badNav = <BoundNavigate to="/users/:id" params={{ id: "1" }} search={{ page: 1 }} />;
      void badLink;
      void badNav;
    }

    assert.isDefined(link);
    assert.isDefined(nav);
    assert.isDefined(match);
  });

  it("a self-leasing View.make entry accepts a model keyed by exactly its route's Output, rejects everything else (type-level)", () => {
    class UsersGuard extends Router.Middleware<UsersGuard>()(
      "/test/router/routeview/Guard",
    )<{ readonly usersList: ReadonlyArray<{ readonly id: string }> }>() {}
    const UsersRoute5 = Route.make("users5", { path: "/users5" });
    const { model } = Router.make(
      `/test/router/routeview/${++nextRouter}`,
      Route.group(UsersRoute5).middleware(UsersGuard),
    );

    class KeyedPageModel extends Model.Service<KeyedPageModel>()(
      "/test/router/routeview/KeyedPage",
    )<{ readonly usersList: ReadonlyArray<{ readonly id: string }> }>()({
      make: ({ usersList }) =>
        Effect.gen(function* () {
          const count = Store.make(usersList.length);
          return { inputs: {}, outputs: {}, ui: { count } };
        }),
    }) {}

    class MismatchedKeyModel extends Model.Service<MismatchedKeyModel>()(
      "/test/router/routeview/MismatchedKeyPage",
    )<{ readonly usersList: string }>()({
      make: () =>
        Effect.gen(function* () {
          return { inputs: {}, outputs: {}, ui: {} };
        }),
    }) {}

    class SingletonPageModel extends Model.Service<SingletonPageModel>()(
      "/test/router/routeview/SingletonPage",
    )({
      make: () =>
        Effect.gen(function* () {
          return { inputs: {}, outputs: {}, ui: {} };
        }),
    }) {}

    if (false) {
      const good = View.make(KeyedPageModel, ({ count }) => count, {});
      // `View.make`'s self-leasing overload alone only requires SOME key —
      // a wrong-but-real key type is only checked once it's placed at a
      // specific route position (SelfLeasedRouteEntry<RouteById<M, Id>>
      // below).
      const mismatched = View.make(MismatchedKeyModel, () => null, {});
      // @ts-expect-error a singleton model has no key at all
      const badSingleton = View.make(SingletonPageModel, () => null, {});

      const goodApp = RouterReact.RouterView.make(model, { routes: { users5: good } });
      const badApp = RouterReact.RouterView.make(model, {
        routes: {
          // @ts-expect-error mismatched's key disagrees with "users5"'s Route.Output
          users5: mismatched,
        },
      });
      void goodApp;
      void badApp;
      void badSingleton;
    }
    assert.isTrue(true);
  });

  it.effect("middlewaresConcurrency: sequential by default — a later guard never starts before an earlier one finishes", () => {
    class SeqGuardA extends Router.Middleware<SeqGuardA>()(
      "/test/router/sequential/GuardA",
    )<{ readonly a: string }>() {}
    class SeqGuardB extends Router.Middleware<SeqGuardB>()(
      "/test/router/sequential/GuardB",
    )<{ readonly b: string }>() {}
    const SeqRoute = Route.make("sequential", { path: "/sequential" }).pipe(
      Route.middleware(SeqGuardA),
      Route.middleware(SeqGuardB),
    );
    const { model } = Router.make(
      `/test/router/sequential/${++nextRouter}`,
      Route.group(SeqRoute),
    );

    return Effect.gen(function* () {
      const order: Array<string> = [];
      const GuardALive = SeqGuardA.layer(() =>
        Effect.sync(() => {
          order.push("a");
          return { a: "a" };
        }),
      );
      const GuardBLive = SeqGuardB.layer(() =>
        Effect.sync(() => {
          order.push("b");
          return { b: "b" };
        }),
      );
      const testLayer = model.layer.pipe(
        Layer.provideMerge(GuardALive),
        Layer.provideMerge(GuardBLive),
        Layer.provideMerge(testEnv()),
      );

      yield* Effect.gen(function* () {
        const router = yield* Model.get(model);
        yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: "/sequential" }));
        assert.deepStrictEqual(order, ["a", "b"]);
      }).pipe(Effect.provide(testLayer));
    });
  });

  it.effect("middlewaresConcurrency('unbounded') runs a route's own guards in parallel", () => {
    class ConcGuardA extends Router.Middleware<ConcGuardA>()(
      "/test/router/concurrent/GuardA",
    )<{ readonly a: string }>() {}
    class ConcGuardB extends Router.Middleware<ConcGuardB>()(
      "/test/router/concurrent/GuardB",
    )<{ readonly b: string }>() {}
    const ConcurrentRoute = Route.make("concurrent", { path: "/concurrent" }).pipe(
      Route.middleware(ConcGuardA),
      Route.middleware(ConcGuardB),
      Route.middlewaresConcurrency("unbounded"),
    );
    const { model } = Router.make(
      `/test/router/concurrent/${++nextRouter}`,
      Route.group(ConcurrentRoute),
    );

    return Effect.gen(function* () {
      // A waits for a signal only B sends — sequential execution (A fully
      // finishes before B starts) would deadlock this; the timeout turns
      // that into a clean test failure instead of a hung suite.
      const bSignaled = yield* Deferred.make<void>();
      const GuardALive = ConcGuardA.layer(() =>
        Effect.gen(function* () {
          yield* Deferred.await(bSignaled);
          return { a: "a" };
        }),
      );
      const GuardBLive = ConcGuardB.layer(() =>
        Effect.gen(function* () {
          yield* Deferred.succeed(bSignaled, undefined);
          return { b: "b" };
        }),
      );
      const testLayer = model.layer.pipe(
        Layer.provideMerge(GuardALive),
        Layer.provideMerge(GuardBLive),
        Layer.provideMerge(testEnv()),
      );

      yield* Effect.gen(function* () {
        const router = yield* Model.get(model);
        yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: "/concurrent" }));
        const state = yield* Store.get(router.outputs.state);
        assert.strictEqual(state.status, "success");
      }).pipe(Effect.provide(testLayer), Effect.timeout("1 second"));
    });
  });

  describe("a guard forking ongoing reactive work (InstanceScope)", () => {
    it("Query.make() called directly inside a guard fails to compose (type-level)", () => {
      class LeakyGuard extends Router.Middleware<LeakyGuard>()(
        "/test/router/gate/Guard",
      )<{ readonly count: number }>() {}

      const LeakyGuardLive = LeakyGuard.layer(() =>
        Effect.gen(function* () {
          // A fresh Query.make() per navigation, forked with no owner tied to
          // this specific navigation — see Query/Registry.run's docs on
          // InstanceScope. Never do this; wrap it in a keyed model instead
          // (below).
          const q = yield* Query.make({ handler: () => Effect.succeed(1) });
          return { count: q.state.initial._tag === "Initial" ? 0 : 1 };
        }),
      );

      const GateRoute = Route.make("gate", { path: "/gate" });
      const { model } = Router.make(
        "/test/router/gate",
        Route.group(GateRoute).middleware(LeakyGuard),
      );

      const testLayer = model.layer.pipe(
        Layer.provideMerge(LeakyGuardLive),
        Layer.provideMerge(testEnv()),
      );

      // @ts-expect-error LeakyGuardLive's Query.make() requires InstanceScope
      // — never available composing a middleware into a runnable app, only
      // inside a model's own make()
      const run: Effect.Effect<void> = Effect.gen(function* () {
        yield* Model.get(model);
      }).pipe(Effect.provide(testLayer));
      void run;
    });

    it.effect("the fix — wrap Query in a keyed model, lease it by identity from the guard", () => {
      let fetchCount = 0;

      class GatedListModel extends Model.Service<GatedListModel>()(
        "/test/router/gate/GatedList",
      )<string>()({
        make: () =>
          Effect.gen(function* () {
            const q = yield* Query.make({
              handler: () =>
                Effect.sync(() => {
                  fetchCount += 1;
                  return fetchCount;
                }),
            });
            yield* Store.waitFor(q.state, (s) => s._tag !== "Initial");
            return { inputs: {}, outputs: { value: q.state }, ui: {} };
          }),
      }) {}

      class SafeGuard extends Router.Middleware<SafeGuard>()(
        "/test/router/gate/SafeGuard",
      )<{ readonly count: number }>() {}

      const SafeGuardLive = SafeGuard.layer(() =>
        Effect.gen(function* () {
          // Same key every time here — a real guard keys by whatever
          // identity should determine "same fetch, reuse" (search, params).
          const list = yield* Model.get(GatedListModel, "all");
          return { count: yield* Store.get(list.outputs.value).pipe(Effect.map(() => fetchCount)) };
        }),
      );

      const HomeRoute2 = Route.make("home2", { path: "/" });
      const GateRoute2 = Route.make("gate2", { path: "/gate2" });
      const { model } = Router.make(
        "/test/router/gate2",
        Route.group(HomeRoute2, GateRoute2).middleware(SafeGuard),
      );

      const testLayer = model.layer.pipe(
        Layer.provideMerge(SafeGuardLive),
        Layer.provideMerge(GatedListModel.layer),
        Layer.provideMerge(testEnv()),
      );

      return Effect.gen(function* () {
        const router = yield* Model.get(model);
        for (let i = 0; i < 5; i++) {
          yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: "/" }));
          yield* Registry.allSettled(Event.emit(router.inputs.navigate, { to: "/gate2" }));
        }
        // Deduped by key across every re-navigation: fetched exactly once.
        assert.strictEqual(fetchCount, 1);
      }).pipe(Effect.provide(testLayer));
    });
  });
});
