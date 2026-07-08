import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as React from "react";
import * as Schema from "effect/Schema";
import { Event, Model, Registry, Query, Store } from "@unitflow/core";
import { Router, RouterGroup } from "../src/index.js";
import * as RouterReact from "../src/react.js";
import { Link, type BoundRouter, type RouteComponent } from "../src/react.js";

const userParams = Schema.Struct({ id: Schema.NumberFromString });
const pageSearch = Schema.Struct({ page: Schema.NumberFromString });

const HomeRoute = Router.route("home", { path: "/" });

const UserRoute = Router.route("user", {
  path: "/users/:id",
  params: userParams,
  search: pageSearch,
});

const SettingsRoute = Router.route("settings", {
  path: "/settings",
});

const routeGroup = Router.group(HomeRoute, UserRoute).merge(
  RouterGroup.make(SettingsRoute).prefix("/admin"),
);

let nextRouter = 0;

const makeRouter = (initial = "/") =>
  Router.make(`/test/router/${++nextRouter}`, routeGroup, {
    history: Router.createMemoryHistory({ initialEntries: [initial] }),
  });

const PageQueryRouter = Router.make("/test/router/page-query", routeGroup, {
  history: Router.createMemoryHistory({ initialEntries: ["/"] }),
});

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
      const userRoute = yield* Model.get(PageQueryRouter.routes, "user");
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
    const AppRouter = makeRouter();
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
    }).pipe(Effect.provide(AppRouter.layer.pipe(Layer.provideMerge(Registry.layer))));
  });

  it.effect("builds prefixed group links through Effect dependency injection", () => {
    const AppRouter = makeRouter();
    return Effect.gen(function* () {
      const href = yield* Router.buildHref(AppRouter, { to: "/admin/settings" });
      assert.strictEqual(href, "/admin/settings");
    }).pipe(Effect.provide(AppRouter.layer.pipe(Layer.provideMerge(Registry.layer))));
  });

  it.effect("exposes navigation as model ports", () => {
    const AppRouter = makeRouter();
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
    }).pipe(Effect.provide(AppRouter.layer.pipe(Layer.provideMerge(Registry.layer))));
  });

  it.effect("exposes every route as a keyed unit with typed ports", () => {
    const testLayer = PageQueryRouter.layer.pipe(Layer.provideMerge(Registry.layer));

    return Effect.gen(function* () {
      const router = yield* Model.get(PageQueryRouter);
      const userRoute = yield* Model.get(PageQueryRouter.routes, "user");

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
        void Model.get(PageQueryRouter.routes, "unknown");
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
      Layer.provideMerge(PageQueryRouter.layer),
      Layer.provideMerge(Layer.succeed(UserEndpoint, endpoint)),
      Layer.provideMerge(Registry.layer),
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

    const AdminRoute = Router.route("admin", { path: "/admin" });
    const OpenRoute = Router.route("open", { path: "/" });
    const guardedGroup = Router.group(OpenRoute).merge(
      Router.group(AdminRoute).middleware(AdminGuard),
    );
    const GuardedRouter = Router.make("/test/router/guarded", guardedGroup, {
      history: Router.createMemoryHistory({ initialEntries: ["/"] }),
    });

    let user: string | undefined = undefined;
    const guardLayer = AdminGuard.make((context) =>
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

    const testLayer = GuardedRouter.layer.pipe(
      Layer.provideMerge(guardLayer),
      Layer.provideMerge(Layer.succeed(Gate, Gate.of({ currentUser: () => user }))),
      Layer.provideMerge(Registry.layer),
    );

    return Effect.gen(function* () {
      const router = yield* Model.get(GuardedRouter);
      const adminRoute = yield* Model.get(GuardedRouter.routes, "admin");

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
          Router.group(
            Router.route("same", { path: "/a" }),
            Router.route("same", { path: "/b" }),
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
    if (false) {
      // @ts-expect-error redirect targets are typed against the registered router
      new Router.RedirectError({ options: { to: "/missing" } });
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
      Router.route("bad-component", { path: "/", component: () => null });
      // @ts-expect-error loaders are gone: route data belongs to the route's model + Query
      Router.route("bad-loader", { path: "/", loader: () => Effect.succeed(1) });
      // @ts-expect-error beforeLoad is gone: gating belongs to the route's model
      Router.route("bad-before", { path: "/", beforeLoad: () => ({}) });
    }
    assert.isTrue(true);
  });

  it("types route params, search, and model-bound links", () => {
    const TypedRouter = makeRouter();
    const OtherRouter = Router.make("/test/router/other", routeGroup, {
      history: Router.createMemoryHistory({ initialEntries: ["/"] }),
    });
    const bound = undefined as unknown as BoundRouter<typeof TypedRouter>;

    const hrefEffect: Effect.Effect<string, unknown, any> = Router.buildHref(TypedRouter, {
      to: "/users/:id",
      params: { id: 1 },
      search: { page: 1 },
    });
    void hrefEffect;

    if (false) {
      // @ts-expect-error path params are required
      Router.buildHref(TypedRouter, { to: "/users/:id", search: { page: 1 } });
      // @ts-expect-error path params use the decoded schema type
      Router.buildHref(TypedRouter, { to: "/users/:id", params: { id: "1" }, search: { page: 1 } });
      // @ts-expect-error search input is typed
      Router.buildHref(TypedRouter, { to: "/users/:id", params: { id: 1 }, search: { page: "1" } });
      // @ts-expect-error paths are constrained to declared route paths
      Router.buildHref(TypedRouter, { to: "/missing" });
      // Providing the WRONG router's layer must not discharge the requirement:
      // the leftover service id keeps the effect from typing as Registry-only.
      // @ts-expect-error DI is tied to the concrete router service id
      const wrongDi: Effect.Effect<string, unknown, Registry> = Router.buildHref(TypedRouter, {
        to: "/users/:id",
        params: { id: 1 },
        search: { page: 1 },
      }).pipe(Effect.provide(OtherRouter.layer.pipe(Layer.provideMerge(Registry.layer))));
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
});
