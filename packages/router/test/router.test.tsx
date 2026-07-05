import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as React from "react";
import * as Schema from "effect/Schema";
import { Model, Registry, Query, Store } from "@unitflow/core";
import { Router, RouterGroup } from "../src/index.js";
import * as RouterReact from "../src/react.js";
import { Link, type BoundRouter, type RouteComponent } from "../src/react.js";

const userParams = Schema.Struct({ id: Schema.NumberFromString });
const pageSearch = Schema.Struct({ page: Schema.NumberFromString });

const HomeRoute = Router.route("home", {
  path: "/",
  component: ({ children }: { readonly children: React.ReactNode }) => <main>{children}</main>,
});

const UserRoute = Router.route("user", {
  path: "/users/:id",
  params: userParams,
  search: pageSearch,
  loader: ({ params, search }) =>
    Effect.succeed({
      label: `${params.id}:${search.page}`,
    }),
  component: ({ children }: { readonly children: React.ReactNode }) => <section>{children}</section>,
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

interface UserEndpointShape {
  readonly getUser: (id: number) => Effect.Effect<{ readonly id: number }, never>;
}

class UserEndpoint extends Context.Service<UserEndpoint, UserEndpointShape>()(
  "/test/router/UserEndpoint",
) {}

class UserRouteQueryModel extends Model.Service<UserRouteQueryModel>()(
  "/test/router/UserRouteQueryModel",
)({
  make: () =>
    Effect.gen(function* () {
      const openedUser = yield* Router.opened(PageQueryRouter, "/users/:id");
      const user = yield* Query.make({
        stores: { openedUser },
        handler: ({ openedUser }) =>
          openedUser === undefined
            ? Effect.fail("page closed" as const)
            : Effect.gen(function* () {
                const endpoint = yield* UserEndpoint;
                return yield* endpoint.getUser(openedUser.params.id);
              }),
      });

      return {
        inputs: {},
        outputs: {
          openedUser,
          user: user.state,
        },
        ui: {
          user: user.state,
        },
      };
    }),
}) {}

describe("@unitflow/router", () => {
  it.effect("matches routes, decodes search, and runs effectful loaders inside a model", () => {
    const AppRouter = makeRouter();
    return Effect.gen(function* () {
      yield* Router.navigate(AppRouter, {
        to: "/users/:id",
        params: { id: 42 },
        search: { page: 2 },
      });

      const router = yield* Model.get(AppRouter);
      const state = yield* Store.get(router.outputs.state);

      assert.strictEqual(state.status, "success");
      assert.strictEqual(state.location.href, "/users/42?page=2");
      const match = state.matches.at(-1);
      assert.isDefined(match);
      assert.strictEqual(match?.route.id, "user");
      assert.deepStrictEqual(match?.params, { id: 42 });
      assert.deepStrictEqual(match?.search, { page: 2 });
      assert.deepStrictEqual(match?.loaderData, { label: "42:2" });
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
        Router.navigate(AppRouter, {
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

  it.effect("lets models gate queries from the opened route output", () => {
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
      yield* Registry.allSettled();

      assert.deepStrictEqual(calls, []);
      assert.strictEqual((yield* Store.get(model.outputs.user))._tag, "Failure");
      assert.isUndefined(yield* Store.get(model.outputs.openedUser));

      yield* Registry.allSettled(
        Router.navigate(PageQueryRouter, {
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
        Router.navigate(PageQueryRouter, {
          to: "/admin/settings",
        }),
      );
      yield* Store.waitFor(model.outputs.user, (result) => result._tag === "Failure");

      assert.deepStrictEqual(calls, [42]);
      assert.strictEqual((yield* Store.get(model.outputs.user))._tag, "Failure");
      assert.isUndefined(yield* Store.get(model.outputs.openedUser));
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

  it("types route params, search, loader data, and model-bound links", () => {
    const TypedRouter = makeRouter();
    const OtherRouter = Router.make("/test/router/other", routeGroup, {
      history: Router.createMemoryHistory({ initialEntries: ["/"] }),
    });
    const bound = undefined as unknown as BoundRouter<typeof TypedRouter>;

    const hrefEffect: Effect.Effect<string, never, any> = Router.buildHref(TypedRouter, {
      to: "/users/:id",
      params: { id: 1 },
      search: { page: 1 },
    });
    void hrefEffect;

    if (false) {
      // @ts-expect-error path params are required
      Router.buildHref(TypedRouter, { to: "/users/:id", search: { page: 1 } });
      // @ts-expect-error path params use the decoded schema type
      Router.buildHref(TypedRouter, {
        to: "/users/:id",
        params: { id: "1" },
        search: { page: 1 },
      });
      // @ts-expect-error search input is typed
      Router.buildHref(TypedRouter, {
        to: "/users/:id",
        params: { id: 1 },
        search: { page: "1" },
      });
      // @ts-expect-error paths are constrained to declared route paths
      Router.buildHref(TypedRouter, { to: "/missing" });
      // @ts-expect-error DI is tied to the concrete router service id
      Router.buildHref(TypedRouter, {
        to: "/users/:id",
        params: { id: 1 },
        search: { page: 1 },
      }).pipe(Effect.provide(OtherRouter.layer.pipe(Layer.provideMerge(Registry.layer))));
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
      const label: string = match.loaderData.label;
      // @ts-expect-error loader data is fully typed
      const wrong: number = match.loaderData.label;
      const nestedLink = (
        <Link router={router} to="/users/:id" params={{ id }} search={{ page }}>
          User
        </Link>
      );
      void label;
      void wrong;
      return nestedLink;
    };

    assert.isDefined(link);
    assert.isDefined(badLink);
    assert.isDefined(UserPanel);
  });
});
