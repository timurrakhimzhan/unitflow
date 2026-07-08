import { Event, Model, Store } from "@unitflow/core";
import { Registry, trackPublish } from "@unitflow/core/registry";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type { ParseOptions } from "effect/SchemaAST";

const RouteTypeId = Symbol.for("@unitflow/router/Route");
const RouteGroupTypeId = Symbol.for("@unitflow/router/RouteGroup");

const PipeableProto: Pipeable = {
  pipe() {
    return pipeArguments(this, arguments);
  },
};

// Type-only import: erased at runtime, so the index → public → router value
// cycle never materializes.
import type { Register } from "./index.js";

type MaybeEffect<A, E, R> = A | Effect.Effect<A, E, R>;

export type SearchPrimitive = string | number | boolean | null | undefined;
export type SearchValue = SearchPrimitive | ReadonlyArray<SearchPrimitive>;
export type RawSearch = Readonly<Record<string, string | ReadonlyArray<string> | undefined>>;
export type SearchRecord = Readonly<Record<string, unknown>>;

type RequiredKeys<A> = {
  [K in keyof A]-?: {} extends Pick<A, K> ? never : K;
}[keyof A];

type EmptyRecord = Record<never, never>;

type SegmentParams<Segment extends string> = Segment extends `:${infer Name}?`
  ? { readonly [K in Name]?: string }
  : Segment extends `:${infer Name}`
    ? { readonly [K in Name]: string }
    : Segment extends `*${infer Name}`
      ? { readonly [K in Name extends "" ? "_splat" : Name]: string }
      : EmptyRecord;

type MergeParams<A, B> = A & B;

type PathParamsLoop<Path extends string> = Path extends `${infer Segment}/${infer Rest}`
  ? MergeParams<SegmentParams<Segment>, PathParamsLoop<Rest>>
  : SegmentParams<Path>;

export type PathParams<Path extends string> = string extends Path
  ? Record<string, string | undefined>
  : PathParamsLoop<Path extends `/${infer Rest}` ? Rest : Path>;

type NormalizePart<A extends string> = A extends `/${infer Rest}`
  ? NormalizePart<Rest>
  : A extends `${infer Rest}/`
    ? NormalizePart<Rest>
    : A;

export type JoinPath<Prefix extends string, Path extends string> = Prefix extends "/"
  ? Path extends "/"
    ? "/"
    : `/${NormalizePart<Path>}`
  : Path extends "/"
    ? `/${NormalizePart<Prefix>}`
    : `/${NormalizePart<Prefix>}/${NormalizePart<Path>}`;

export interface SearchCodec<Input extends SearchRecord, Output, E, R> extends Pipeable {
  readonly decode: (raw: RawSearch) => MaybeEffect<Output, E, R>;
  readonly encode?: (input: Input) => RawSearch;
  readonly "~input": Input;
  readonly "~output": Output;
  readonly "~error": E;
  readonly "~services": R;
}

export type AnySearchCodec = SearchCodec<any, any, any, any>;
export type AnySchemaCodec = Schema.Codec<any, any, any, any>;
type AnyParamsSchema = AnySchemaCodec | undefined;
type AnySearchDefinition = AnySearchCodec | AnySchemaCodec | undefined;
type SchemaTypeOf<S> = S extends Schema.Codec<infer A, any, any, any> ? A : never;
type ParamsOutputOf<Path extends string, ParamsSchema> = ParamsSchema extends AnySchemaCodec
  ? SchemaTypeOf<ParamsSchema>
  : PathParams<Path>;
type ParamsInputOf<Path extends string, ParamsSchema> = ParamsSchema extends AnySchemaCodec
  ? SchemaTypeOf<ParamsSchema>
  : PathParams<Path>;
type ParamsErrorOf<ParamsSchema> = ParamsSchema extends AnySchemaCodec ? Schema.SchemaError : never;
type ParamsServicesOf<ParamsSchema> = ParamsSchema extends AnySchemaCodec
  ? Schema.Codec.DecodingServices<ParamsSchema> | Schema.Codec.EncodingServices<ParamsSchema>
  : never;
type SearchInputOf<S> = S extends SearchCodec<infer I, any, any, any>
  ? I
  : S extends AnySchemaCodec
    ? SchemaTypeOf<S>
    : EmptyRecord;
type SearchOutputOf<S> = S extends SearchCodec<any, infer A, any, any>
  ? A
  : S extends AnySchemaCodec
    ? SchemaTypeOf<S>
    : EmptyRecord;
type SearchErrorOf<S> = S extends SearchCodec<any, any, infer E, any>
  ? E
  : S extends AnySchemaCodec
    ? Schema.SchemaError
    : never;
type SearchServicesOf<S> = S extends SearchCodec<any, any, any, infer R>
  ? R
  : S extends AnySchemaCodec
    ? Schema.Codec.DecodingServices<S> | Schema.Codec.EncodingServices<S>
    : never;

export const search = <Input extends SearchRecord, Output = Input, E = never, R = never>(
  decode: (raw: RawSearch) => MaybeEffect<Output, E, R>,
  options?: { readonly encode?: (input: Input) => RawSearch },
): SearchCodec<Input, Output, E, R> => ({
  ...PipeableProto,
  decode,
  ...(options?.encode === undefined ? {} : { encode: options.encode }),
  "~input": undefined as unknown as Input,
  "~output": undefined as unknown as Output,
  "~error": undefined as unknown as E,
  "~services": undefined as unknown as R,
});

export const schemaSearch = <
  A extends SearchRecord,
  I extends SearchRecord,
  RD,
  RE,
>(
  schema: Schema.Codec<A, I, RD, RE>,
  options?: ParseOptions,
): SearchCodec<I, A, Schema.SchemaError, RD> =>
  search<I, A, Schema.SchemaError, RD>((raw) => Schema.decodeUnknownEffect(schema)(raw, options));

export interface RouteContext<Path extends string, Params, Search> {
  readonly route: Route.Any;
  readonly location: ParsedLocation;
  readonly params: Params;
  readonly search: Search;
  readonly path: Path;
}

export interface RouteOptions<
  Path extends string,
  ParamsSchema extends AnyParamsSchema,
  Search extends AnySearchDefinition,
> {
  readonly path: Path;
  readonly params?: ParamsSchema;
  readonly search?: Search;
  readonly parseParams?: (
    params: PathParams<Path>,
  ) => MaybeEffect<ParamsOutputOf<Path, ParamsSchema> | false, any, any>;
  readonly stringifyParams?: (params: ParamsInputOf<Path, ParamsSchema>) => PathParams<Path>;
  /** The model backing this route's data/behavior. The router never
   * constructs or reads it — it is a plain reference for application code
   * (rendering, prefetching) to act on. */
  readonly model?: Model.AnyService;
  readonly staticData?: SearchRecord;
  readonly meta?: (
    context: RouteContext<Path, ParamsOutputOf<Path, ParamsSchema>, SearchOutputOf<Search>>,
  ) => ReadonlyArray<SearchRecord>;
  readonly links?: (
    context: RouteContext<Path, ParamsOutputOf<Path, ParamsSchema>, SearchOutputOf<Search>>,
  ) => ReadonlyArray<SearchRecord>;
  readonly caseSensitive?: boolean;
}

/** What a middleware handler receives: the matched route's decoded
 * params/search and the target location — read-only, before the navigation
 * commits. */
export type MiddlewareContext = RouteContext<string, unknown, unknown>;

/** The service value behind a middleware tag: a guard run for every matched
 * route the middleware is attached to, BEFORE the navigation commits.
 * Failing with {@link RedirectError}/{@link NotFoundError} cancels the
 * navigation — the blocked URL never reaches history or state. A non-void
 * success value is the middleware's `Provides`: it lands in the route
 * unit's `provided` port, `Option.some` whenever the route is open — the
 * guard having passed is what LET it open. */
export interface MiddlewareHandler<Provides = void> {
  (context: MiddlewareContext): Effect.Effect<Provides, RedirectError | NotFoundError>;
}

export type AnyMiddleware = Context.Service<any, MiddlewareHandler<any>>;

export type ProvidesOf<M> = M extends { readonly "~provides": infer P } ? P : never;

/**
 * Declares a middleware as a Context service — a TAG, not a function — so
 * the router only ever requires the tag: the implementation (and ITS
 * dependencies) live in the layer `make` builds, composed at the feature
 * level. Attaching an inline function instead would leak every guard's
 * services into the router's own requirements.
 *
 * ```ts
 * class AuthGuard extends Router.Middleware<AuthGuard>()("app/AuthGuard") {}
 * const AuthGuardLive = AuthGuard.make((ctx) => Effect.gen(function* () {
 *   const session = yield* SessionService;
 *   if (!session.canAccess) return yield* Effect.fail(Router.RedirectError({ to: "/login" }));
 * }));
 * ```
 */
export interface MiddlewareClass<Self, Id extends string, Provides = void>
  extends Context.ServiceClass<Self, Id, MiddlewareHandler<Provides>> {
  /** Type-level only: what the guard provides to the routes it protects. */
  readonly "~provides": Provides;
  /** Builds the implementation layer. The handler's services are resolved
   * once at layer build and captured, so the stored handler itself is
   * dependency-free — the router only ever requires the tag. */
  readonly make: <R = never>(
    handler: (
      context: MiddlewareContext,
    ) => Effect.Effect<Provides, RedirectError | NotFoundError, R>,
  ) => Layer.Layer<Self, never, R>;
}

export const Middleware =
  <Self>() =>
  <const Id extends string>(id: Id) =>
  <Provides = void>(): MiddlewareClass<Self, Id, Provides> => {
    const Service = Context.Service<Self, MiddlewareHandler<Provides>>()(id);
    return class extends Service {
      static readonly make = <R = never>(
        handler: (
          context: MiddlewareContext,
        ) => Effect.Effect<Provides, RedirectError | NotFoundError, R>,
      ): Layer.Layer<Self, never, R> =>
        Layer.effect(
          Service,
          Effect.map(
            Effect.context<R>(),
            (services): MiddlewareHandler<Provides> =>
              (context) =>
                // The captured context covers exactly `R`; the cast erases
                // the generic TypeScript cannot discharge here.
                // eslint-disable-next-line revizo/no-type-assertion
                Effect.provide(handler(context), services) as Effect.Effect<
                  Provides,
                  RedirectError | NotFoundError
                >,
          ),
        );
    } as MiddlewareClass<Self, Id, Provides>;
  };

export interface Route<
  Id extends string,
  Path extends string,
  ParamsSchema extends AnyParamsSchema,
  Search extends AnySearchDefinition,
  Requires = never,
  Provided = EmptyRecord,
> extends Pipeable {
  readonly [RouteTypeId]: typeof RouteTypeId;
  readonly id: Id;
  readonly path: Path;
  readonly options: RouteOptions<Path, ParamsSchema, Search>;
  readonly middlewares: ReadonlyArray<AnyMiddleware>;
  readonly "~types": {
    readonly id: Id;
    readonly path: Path;
    readonly params: ParamsOutputOf<Path, ParamsSchema>;
    readonly paramsInput: ParamsInputOf<Path, ParamsSchema>;
    readonly search: SearchOutputOf<Search>;
    readonly searchInput: SearchInputOf<Search>;
    readonly provided: Provided;
    readonly error: ParamsErrorOf<ParamsSchema> | SearchErrorOf<Search> | RedirectError | NotFoundError;
    readonly services: ParamsServicesOf<ParamsSchema> | SearchServicesOf<Search> | Requires;
  };
}

export namespace Route {
  export type Any = Route<string, any, AnyParamsSchema, AnySearchDefinition, any, any>;
  export type Id<R extends Any> = R["~types"]["id"];
  export type Path<R extends Any> = R["~types"]["path"];
  export type Params<R extends Any> = R["~types"]["params"];
  export type ParamsInput<R extends Any> = R["~types"]["paramsInput"];
  export type Search<R extends Any> = R["~types"]["search"];
  export type SearchInput<R extends Any> = R["~types"]["searchInput"];
  export type Provided<R extends Any> = R["~types"]["provided"];
  export type Error<R extends Any> = R["~types"]["error"];
  export type Services<R extends Any> = R["~types"]["services"];
}

export const isRoute = (value: unknown): value is Route.Any =>
  typeof value === "object" && value !== null && RouteTypeId in value;

export const route = <
  const Id extends string,
  const Path extends string,
  ParamsSchema extends AnyParamsSchema = undefined,
  Search extends AnySearchDefinition = undefined,
>(
  id: Id,
  options: RouteOptions<Path, ParamsSchema, Search>,
): Route<Id, Path, ParamsSchema, Search> => ({
  ...PipeableProto,
  [RouteTypeId]: RouteTypeId,
  id,
  path: normalizePath(options.path) as Path,
  options: { ...options, path: normalizePath(options.path) as Path },
  middlewares: [],
  "~types": undefined as unknown as Route<Id, Path, ParamsSchema, Search>["~types"],
});

type PrefixedRoute<R extends Route.Any, Prefix extends string> = R extends Route<
  infer Id,
  infer Path,
  infer ParamsSchema,
  infer Search,
  infer Requires,
  infer Provided
>
  ? Route<Id, JoinPath<Prefix, Path>, ParamsSchema, Search, Requires, Provided>
  : never;

const prefixRoute = <R extends Route.Any, const Prefix extends string>(
  current: R,
  prefix: Prefix,
): PrefixedRoute<R, Prefix> => {
  const path = joinPaths(prefix, current.path);
  // Spread (not `route(...)`) so `middlewares` and the pipe method survive.
  return {
    ...current,
    path,
    options: { ...current.options, path },
  } as unknown as PrefixedRoute<R, Prefix>;
};

type WithMiddleware<R extends Route.Any, M extends AnyMiddleware> = R extends Route<
  infer Id,
  infer Path,
  infer ParamsSchema,
  infer Search,
  infer Requires,
  infer Provided
>
  ? Route<
      Id,
      Path,
      ParamsSchema,
      Search,
      Requires | Context.Service.Identifier<M>,
      [ProvidesOf<M>] extends [void] ? Provided : Provided & ProvidesOf<M>
    >
  : never;

export interface RouteGroup<R extends Route.Any> extends Pipeable {
  readonly [RouteGroupTypeId]: typeof RouteGroupTypeId;
  readonly routes: ReadonlyArray<R>;
  add<const R2 extends ReadonlyArray<Route.Any>>(...routes: R2): RouteGroup<R | R2[number]>;
  merge<const Groups extends ReadonlyArray<AnyRouteGroup>>(
    ...groups: Groups
  ): RouteGroup<R | RoutesOf<Groups[number]>>;
  prefix<const Prefix extends string>(prefix: Prefix): RouteGroup<PrefixedRoute<R, Prefix>>;
  /** Attaches a middleware TAG to every route currently in the group: the
   * router will require the tag's implementation layer, run it for each
   * matched route before committing a navigation. */
  middleware<M extends AnyMiddleware>(middleware: M): RouteGroup<WithMiddleware<R, M>>;
}

export type AnyRouteGroup = RouteGroup<Route.Any>;
export type RoutesOf<Group> = Group extends RouteGroup<infer R> ? R : never;

const RouteGroupProto = {
  add(this: AnyRouteGroup, ...added: ReadonlyArray<Route.Any>) {
    return group(...this.routes, ...added);
  },
  merge(this: AnyRouteGroup, ...groups: ReadonlyArray<AnyRouteGroup>) {
    return group(...this.routes, ...groups.flatMap((current) => current.routes));
  },
  prefix(this: AnyRouteGroup, prefix: string) {
    return group(...this.routes.map((current) => prefixRoute(current, prefix)));
  },
  middleware(this: AnyRouteGroup, middleware: AnyMiddleware) {
    return group(
      ...this.routes.map((current) => ({
        ...current,
        middlewares: [...current.middlewares, middleware],
      })),
    );
  },
};

export const group = <const Routes extends ReadonlyArray<Route.Any>>(
  ...routes: Routes
): RouteGroup<Routes[number]> =>
  Object.assign(Object.create(PipeableProto), RouteGroupProto, {
    [RouteGroupTypeId]: RouteGroupTypeId,
    routes,
  });

export const makeGroup = group;

export const add = <const Routes extends ReadonlyArray<Route.Any>>(
  ...routes: Routes
): RouteGroup<Routes[number]> => group(...routes);

export const merge = <const Groups extends ReadonlyArray<AnyRouteGroup>>(
  ...groups: Groups
): RouteGroup<RoutesOf<Groups[number]>> =>
  group(...groups.flatMap((current) => current.routes)) as RouteGroup<RoutesOf<Groups[number]>>;

export const prefix = <const Prefix extends string, Group extends AnyRouteGroup>(
  routeGroup: Group,
  path: Prefix,
): RouteGroup<PrefixedRoute<RoutesOf<Group>, Prefix>> =>
  routeGroup.prefix(path) as unknown as RouteGroup<PrefixedRoute<RoutesOf<Group>, Prefix>>;

export const routes = <Group extends AnyRouteGroup>(routeGroup: Group): ReadonlyArray<RoutesOf<Group>> =>
  routeGroup.routes as unknown as ReadonlyArray<RoutesOf<Group>>;

export interface ParsedLocation {
  readonly pathname: string;
  readonly search: RawSearch;
  readonly searchString: string;
  readonly hash: string;
  readonly href: string;
  readonly state: unknown;
}

export interface RouterHistory {
  readonly location: ParsedLocation;
  push(href: string, state?: unknown): void;
  replace(href: string, state?: unknown): void;
  subscribe(listener: (location: ParsedLocation) => void): () => void;
}

export interface RouteMatch<R extends Route.Any = Route.Any> {
  readonly id: Route.Id<R>;
  readonly route: R;
  readonly pathname: string;
  readonly params: Route.Params<R>;
  readonly search: Route.Search<R>;
  /** What the matched branch's middlewares provided, parents included. */
  readonly provided: Route.Provided<R>;
  readonly staticData: SearchRecord;
  readonly meta: ReadonlyArray<SearchRecord>;
  readonly links: ReadonlyArray<SearchRecord>;
  readonly status: "success" | "pending" | "error";
  readonly error?: unknown;
}

export interface RouterState<R extends Route.Any = Route.Any> {
  readonly status: "idle" | "pending" | "success" | "error" | "not-found";
  readonly location: ParsedLocation;
  readonly resolvedLocation: ParsedLocation;
  readonly matches: ReadonlyArray<RouteMatch<R>>;
  readonly pendingLocation?: ParsedLocation;
  readonly error?: unknown;
}

export interface RouterOptions {
  readonly basepath?: string;
  readonly parseSearch?: (search: string) => RawSearch;
  readonly stringifySearch?: (search: SearchRecord) => string;
}

/** What the {@link History} service holds: a factory rather than a ready
 * history, because a history builds `ParsedLocation`s and therefore needs
 * the owning router's `parseSearch`. Each router calls it once, so two
 * routers under one layer get independent histories. */
export interface HistoryFactory {
  readonly make: (options: {
    readonly parseSearch: (search: string) => RawSearch;
  }) => RouterHistory;
}

/**
 * The history capability, provided as a LAYER — `Router.make` declares
 * routes only, the environment decides how locations are read and written:
 *
 * ```ts
 * AppRouter.layer.pipe(Layer.provideMerge(Router.browserHistoryLayer))
 * // tests:
 * AppRouter.layer.pipe(Layer.provideMerge(Router.memoryHistoryLayer({ initialEntries: ["/"] })))
 * ```
 */
export class History extends Context.Service<History, HistoryFactory>()(
  "@unitflow/router/History",
) {}

export const browserHistoryLayer: Layer.Layer<History> = Layer.succeed(
  History,
  History.of({ make: (options) => createBrowserHistory(options) }),
);

export const hashHistoryLayer: Layer.Layer<History> = Layer.succeed(
  History,
  History.of({ make: (options) => createHashHistory(options) }),
);

export const memoryHistoryLayer = (options?: {
  readonly initialEntries?: ReadonlyArray<string>;
}): Layer.Layer<History> =>
  Layer.succeed(
    History,
    History.of({
      make: ({ parseSearch }) =>
        createMemoryHistory(
          options?.initialEntries === undefined
            ? { parseSearch }
            : { initialEntries: options.initialEntries, parseSearch },
        ),
    }),
  );

export interface ActiveOptions {
  readonly exact?: boolean;
  readonly includeHash?: boolean;
  readonly includeSearch?: boolean;
}

export type Blocker = (options: {
  readonly from: ParsedLocation;
  readonly to: ParsedLocation;
}) => boolean | Promise<boolean>;

/** The synchronous, read-only surface backing `outputs.api` — used
 * internally (`buildLocation`/`buildHref`/`matchRoute` free functions, and
 * the React binding's need for a value it can read outside an Effect).
 * Every action (navigate/blockers) lives only on `inputs` as an event —
 * this type intentionally has no method for any of them. */
export interface RouterController<Group extends AnyRouteGroup = AnyRouteGroup> {
  readonly group: Group;
  readonly routes: ReadonlyArray<RoutesOf<Group>>;
  readonly options: RouterOptions;
  readonly history: RouterHistory;
  readonly buildLocation: <const To extends RoutePath<RouterController<Group>>>(
    options: ToOptions<RouterController<Group>, To>,
  ) => ParsedLocation;
  readonly buildHref: <const To extends RoutePath<RouterController<Group>>>(
    options: ToOptions<RouterController<Group>, To>,
  ) => string;
  readonly buildLocationEffect: <const To extends RoutePath<RouterController<Group>>>(
    options: ToOptions<RouterController<Group>, To>,
  ) => Effect.Effect<ParsedLocation, unknown, RouterServicesForGroup<Group> | Registry>;
  readonly buildHrefEffect: <const To extends RoutePath<RouterController<Group>>>(
    options: ToOptions<RouterController<Group>, To>,
  ) => Effect.Effect<string, unknown, RouterServicesForGroup<Group> | Registry>;
  readonly matchRoute: <const To extends RoutePath<RouterController<Group>>>(
    options: ToOptions<RouterController<Group>, To> & ActiveOptions,
  ) => boolean;
}

export type AnyRouterController = RouterController<any>;

/** A navigation payload with no free `To` parameter (event payloads, stored
 * redirect options): distributes over the router's paths so `to` acts as the
 * union discriminant — `params`/`search` are then checked against exactly
 * the targeted route, not a merged shape where an empty-params member would
 * structurally accept anything. */
export type NavigatePayload<M extends AnyRouter> = RoutePath<M> extends infer To
  ? To extends RoutePath<M>
    ? NavigateOptions<M, To>
    : never
  : never;

export interface RouterShape<Group extends AnyRouteGroup> extends Model.Shape {
  readonly inputs: {
    readonly navigate: Event.Event<NavigateOptions<RouterController<Group>, RoutePath<RouterController<Group>>>>;
    readonly addBlocker: Event.Event<Blocker>;
    readonly removeBlocker: Event.Event<Blocker>;
  };
  readonly outputs: {
    readonly state: Store.Store<RouterState<RoutesOf<Group>>>;
    readonly location: Store.Combined<ParsedLocation>;
    readonly matches: Store.Combined<ReadonlyArray<RouteMatch<RoutesOf<Group>>>>;
    readonly api: Store.Store<RouterController<Group>>;
  };
  readonly ui: {
    readonly state: Store.Store<RouterState<RoutesOf<Group>>>;
    readonly location: Store.Combined<ParsedLocation>;
    readonly matches: Store.Combined<ReadonlyArray<RouteMatch<RoutesOf<Group>>>>;
    readonly navigate: Event.Event<NavigateOptions<RouterController<Group>, RoutePath<RouterController<Group>>>>;
    readonly api: Store.Store<RouterController<Group>>;
  };
}

type RouterServicesForGroup<Group extends AnyRouteGroup> = RoutesOf<Group> extends infer R
  ? R extends Route.Any
    ? Route.Services<R>
    : never
  : never;

/** The ports one route's unit exposes: occupancy and the decoded
 * params/search — `false`/`Option.none()` while the route is not on screen.
 * The engine's raw `RouteMatch` record stays internal to the router. */
export interface RouteUnitShape<R extends Route.Any> extends Model.Shape {
  readonly inputs: Record<never, never>;
  readonly outputs: {
    readonly opened: Store.Combined<boolean>;
    readonly params: Store.Combined<Option.Option<Route.Params<R>>>;
    readonly search: Store.Combined<Option.Option<Route.Search<R>>>;
    readonly provided: Store.Combined<Option.Option<Route.Provided<R>>>;
  };
  readonly ui: {
    readonly opened: Store.Combined<boolean>;
    readonly params: Store.Combined<Option.Option<Route.Params<R>>>;
    readonly search: Store.Combined<Option.Option<Route.Search<R>>>;
    readonly provided: Store.Combined<Option.Option<Route.Provided<R>>>;
  };
}

export type RouteIds<Group extends AnyRouteGroup> = Route.Id<RoutesOf<Group>>;

/** The per-key shape map of {@link RoutesModel}: each route id maps to the
 * unit shape of THAT route, so `Model.get(router.routes, "user")` comes back
 * with `params`/`search` typed by the "user" route's schemas. */
export type RouteShapes<Group extends AnyRouteGroup> = {
  readonly [Id in RouteIds<Group>]: RouteUnitShape<Extract<RoutesOf<Group>, { readonly id: Id }>>;
};

/** The keyed model behind `router.routes`: one unit per route id, derived
 * from the router's `outputs.matches`. */
export interface RoutesModel<
  Id extends string = string,
  Group extends AnyRouteGroup = AnyRouteGroup,
> extends Model.ServiceClass<
    RoutesModel<Id, Group>,
    `${Id}/routes`,
    RouteIds<Group>,
    RouteUnitShape<RoutesOf<Group>>,
    never,
    RouterModel<Id, Group> | Registry
  > {
  readonly modelShapes: RouteShapes<Group>;
}

export interface RouterModel<
  Id extends string = string,
  Group extends AnyRouteGroup = AnyRouteGroup,
> extends Model.ServiceClass<
    RouterModel<Id, Group>,
    Id,
    void,
    RouterShape<Group>,
    never,
    RouterServicesForGroup<Group> | History | Registry
  > {
  readonly group: Group;
  /** One `Model.get(router.routes, "<id>")` away from a route's typed unit:
   * `outputs.opened`/`params`/`search`, narrowed to that id. */
  readonly routes: RoutesModel<Id, Group>;
  /** Provides BOTH services: the router itself and its `routes` model.
   * Requires the {@link History} capability — provide
   * `browserHistoryLayer`/`hashHistoryLayer`/`memoryHistoryLayer`. */
  readonly layer: Layer.Layer<
    RouterModel<Id, Group> | RoutesModel<Id, Group>,
    never,
    Exclude<RouterServicesForGroup<Group>, Registry> | History | Registry
  >;
  readonly options: RouterOptions;
  readonly routerType: {
    readonly id: Id;
    readonly group: Group;
  };
}

// `any` (not `string`/`AnyRouteGroup`) so a concrete RouterModel satisfies
// the constraint: `Self` occurs in `layer: Layer<Self>`, whose variance
// otherwise rejects narrowing the group parameter.
export type AnyRouter = RouterModel<any, any>;
export type RegisteredRouter = Register extends { readonly router: infer R extends AnyRouter }
  ? R
  : AnyRouter;
export type RouterGroupOf<TRouter> =
  TRouter extends RouterModel<any, infer Group>
    ? Group
    : TRouter extends RouterController<infer Group>
      ? Group
      : never;
export type RouterRoutes<TRouter> = RoutesOf<RouterGroupOf<TRouter>>;
export type RoutePath<TRouter> = RouterRoutes<TRouter> extends infer R
  ? R extends Route.Any
    ? Route.Path<R>
    : never
  : never;
export type RouteByPath<TRouter, Path> = Extract<RouterRoutes<TRouter>, { readonly path: Path }>;
export type MatchByPath<TRouter, Path> = RouteMatch<RouteByPath<TRouter, Path>>;
export type MatchUnion<TRouter> = RouterRoutes<TRouter> extends infer R
  ? R extends Route.Any
    ? RouteMatch<R>
    : never
  : never;
export type RouterControllerOf<M extends AnyRouter> = RouterController<RouterGroupOf<M>>;

type PathParamsFor<TRouter, To> = Route.ParamsInput<RouteByPath<TRouter, To>>;
type SearchInputFor<TRouter, To> = Route.SearchInput<RouteByPath<TRouter, To>>;

// `0 extends 1 & T` detects `any`: an erased router (AnyRouter — e.g. the
// options stored inside RedirectError) must stay lenient, while a concrete
// router keeps params/search required.
type IsAny<T> = 0 extends 1 & T ? true : false;

type PathParamOptions<Params> = IsAny<Params> extends true
  ? { readonly params?: Params | true }
  : keyof Params extends never
    ? { readonly params?: Params | true }
    : { readonly params: Params | true };

type SearchParamOptions<Search> = IsAny<Search> extends true
  ? { readonly search?: Search | true | ((current: RawSearch) => Search) }
  : keyof Search extends never
    ? { readonly search?: Search | true | ((current: RawSearch) => Search) }
    : RequiredKeys<Search> extends never
      ? { readonly search?: Search | true | ((current: RawSearch) => Search) }
      : { readonly search: Search | true | ((current: RawSearch) => Search) };

export type ToOptions<TRouter extends AnyRouter | AnyRouterController, To extends RoutePath<TRouter>> = {
  readonly to: To;
  readonly hash?: string | true;
  readonly state?: unknown;
} & PathParamOptions<PathParamsFor<TRouter, To>> &
  SearchParamOptions<SearchInputFor<TRouter, To>>;

export type NavigateOptions<
  TRouter extends AnyRouter | AnyRouterController,
  To extends RoutePath<TRouter>,
> = ToOptions<TRouter, To> & {
  readonly replace?: boolean;
  readonly resetScroll?: boolean;
  readonly viewTransition?: boolean;
  readonly ignoreBlocker?: boolean;
  readonly reloadDocument?: boolean;
  readonly mask?: ToOptions<TRouter, RoutePath<TRouter>>;
};

/** A middleware/codec verdict, NOT a crash: it travels the typed error
 * channel purely as the short-circuit — `navigate` catches it and follows
 * the redirect before anything commits. */
export class RedirectError extends Data.TaggedError("RedirectError")<{
  // Typed against the REGISTERED router: after the app's
  // `declare module ... { interface Register { router: typeof AppRouter } }`
  // redirect targets are checked exactly like navigate options; without
  // registration this erases to the lenient AnyRouter form.
  readonly options: NavigatePayload<RegisteredRouter>;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly routeId?: string;
}> {}

export const isRedirectError = (value: unknown): value is RedirectError =>
  value instanceof RedirectError;
export const isNotFoundError = (value: unknown): value is NotFoundError =>
  value instanceof NotFoundError;

interface CompiledRoute<R extends Route.Any> {
  readonly route: R;
  readonly exact: RegExp;
  readonly prefix: RegExp;
  readonly paramNames: ReadonlyArray<{ readonly name: string; readonly optional: boolean }>;
  readonly score: number;
  readonly length: number;
}

type StaticParamOptions<Params> = IsAny<Params> extends true
  ? { readonly params?: Params }
  : keyof Params extends never
    ? { readonly params?: Params }
    : { readonly params: Params };

type StaticSearchOptions<Search> = IsAny<Search> extends true
  ? { readonly search?: Search }
  : keyof Search extends never
    ? { readonly search?: Search }
    : RequiredKeys<Search> extends never
      ? { readonly search?: Search }
      : { readonly search: Search };

/** A route target expressible WITHOUT a live router: unlike
 * {@link ToOptions} there are no `search: true`/`hash: true`/function forms
 * — those inherit from the current location and stay on `navigate`/`Link`. */
export type TargetOptions<TRouter extends AnyRouter | AnyRouterController, To extends RoutePath<TRouter>> = {
  readonly to: To;
  readonly hash?: string;
  readonly state?: unknown;
} & StaticParamOptions<PathParamsFor<TRouter, To>> &
  StaticSearchOptions<SearchInputFor<TRouter, To>>;

/** Location builders attached to the router value itself: PURE, synchronous
 * functions of the static route table — no DI, no instance. Schema codecs
 * encode synchronously (an async/service-requiring codec is a defect).
 * A separate interface intersected onto {@link RouterModel} at `make` —
 * declared inside RouterModel these signatures close a resolution cycle
 * (param -> options type -> AnyRouter -> RouterModel -> param) that the
 * ServiceClass heritage forces TypeScript to evaluate eagerly. */
export interface RouterTargets<Group extends AnyRouteGroup> {
  /** Builds a location for a route target without navigating. */
  readonly buildLocation: <const To extends RoutePath<RouterController<Group>>>(
    options: TargetOptions<RouterController<Group>, To>,
  ) => ParsedLocation;
  /** Builds an href string for a route target without navigating. */
  readonly buildHref: <const To extends RoutePath<RouterController<Group>>>(
    options: TargetOptions<RouterController<Group>, To>,
  ) => string;
}

export const make = <const Id extends string, const Group extends AnyRouteGroup>(
  id: Id,
  routeGroup: Group,
  options: RouterOptions = {},
): RouterModel<Id, Group> & RouterTargets<Group> => {
  // The `routes` model's per-key claim — `Model.get(router.routes, K)`
  // returns THE route with id K — is only sound if ids are unique: the unit
  // resolves its route by `find(route.id === key)`. Enforce the
  // precondition here instead of silently matching the first duplicate.
  const seenIds = new Set<string>();
  for (const current of routeGroup.routes) {
    if (seenIds.has(current.id)) {
      throw new Error(`Unitflow router "${id}" has duplicate route id "${current.id}".`);
    }
    seenIds.add(current.id);
  }

  const service = Model.Service<RouterModel<Id, Group>>()(id)({
    lifetime: "keepAlive",
    make: () => makeShape(routeGroup, options),
  });

  const router = Object.assign(service, {
    group: routeGroup,
    options,
    routerType: undefined as unknown as RouterModel<Id, Group>["routerType"],
  }) as RouterModel<Id, Group>;

  // The per-key shape map is carried by the RoutesModel interface itself
  // (the cast below) rather than the builder's `Shapes` argument: with
  // `Group` still generic TypeScript cannot verify the mapped-type
  // constraint and overload resolution falls apart.
  const routesService = Model.Service<RoutesModel<Id, Group>>()(
    `${id}/routes` as `${Id}/routes`,
  )<RouteIds<Group>>()({
    make: (routeId: RouteIds<Group>) =>
      Effect.gen(function* () {
        const ports = yield* Model.get(router);
        const match = Store.combine(
          [ports.outputs.matches],
          (matches) => Option.fromNullishOr(matches.find((current) => current.route.id === routeId)),
          { name: `router.routes.${routeId}.match` },
        );
        const opened = Store.combine([match], Option.isSome, {
          name: `router.routes.${routeId}.opened`,
        });
        const params = Store.combine([match], Option.map((current) => current.params), {
          name: `router.routes.${routeId}.params`,
        });
        const search = Store.combine([match], Option.map((current) => current.search), {
          name: `router.routes.${routeId}.search`,
        });
        const provided = Store.combine([match], Option.map((current) => current.provided), {
          name: `router.routes.${routeId}.provided`,
        });
        return {
          inputs: {},
          outputs: { opened, params, search, provided },
          ui: { opened, params, search, provided },
        };
      }),
  });
  const routes = routesService as unknown as RoutesModel<Id, Group>;

  const parseSearch = options.parseSearch ?? defaultParseSearch;
  const stringifySearch = options.stringifySearch ?? defaultStringifySearch;
  const buildLocation = (
    target: TargetOptions<RouterController<Group>, RoutePath<RouterController<Group>>>,
  ): ParsedLocation => {
    const found = routeGroup.routes.find((current) => current.path === target.to);
    if (found === undefined) {
      throw new Error(`Unitflow router cannot build unknown route "${String(target.to)}".`);
    }
    const paramsSchema = found.options.params;
    const paramsSource = target.params ?? {};
    const routeParams =
      paramsSchema !== undefined
        ? // A codec whose ENCODING needs services cannot be built statically —
          // that exotic case dies here as a defect, by design.
          // eslint-disable-next-line revizo/no-type-assertion
          toPathParams(Schema.encodeSync(paramsSchema as Schema.Codec<any, any, any, never>)(paramsSource))
        : found.options.stringifyParams !== undefined
          ? found.options.stringifyParams(paramsSource as never)
          : toPathParams(paramsSource);
    const pathname = addBasepath(interpolatePath(found.path, routeParams), options.basepath);
    const definition = found.options.search;
    const searchSource = (target.search ?? {}) as SearchRecord;
    const rawSearch =
      definition === undefined
        ? toRawSearch(searchSource)
        : isSchemaCodec(definition)
          ? // eslint-disable-next-line revizo/no-type-assertion
            toRawSearch(Schema.encodeSync(definition as Schema.Codec<any, any, any, never>)(searchSource))
          : definition.encode === undefined
            ? toRawSearch(searchSource)
            : definition.encode(searchSource as never);
    const searchString = stringifySearch(rawSearch);
    const hash = target.hash ?? "";
    return makeLocation(
      `${pathname}${searchString}${hash === "" ? "" : `#${hash}`}`,
      parseSearch,
      target.state,
    );
  };

  return Object.assign(router, {
    routes,
    layer: routes.layer.pipe(Layer.provideMerge(router.layer)),
    buildLocation,
    buildHref: (target: TargetOptions<RouterController<Group>, RoutePath<RouterController<Group>>>) =>
      buildLocation(target).href,
  } as never);
};

const makeShape = <Group extends AnyRouteGroup>(
  routeGroup: Group,
  options: RouterOptions,
): Effect.Effect<RouterShape<Group>, never, RouterServicesForGroup<Group> | History | Registry> =>
  (Effect.gen(function* () {
    const parseSearch = options.parseSearch ?? defaultParseSearch;
    const stringifySearch = options.stringifySearch ?? defaultStringifySearch;
    const history = (yield* History).make({ parseSearch });
    const compiled = routeGroup.routes.map(compileRoute).sort((a, b) => b.score - a.score);
    const blockers = new Set<Blocker>();
    let disposed = false;
    let ignoreNextHistory = false;

    let currentState: RouterState<RoutesOf<Group>> = {
      status: "idle",
      location: history.location,
      resolvedLocation: history.location,
      matches: [],
    };

    const state = Store.make<RouterState<RoutesOf<Group>>>(currentState, {
      name: "router.state",
    });

    const setState = (
      next: RouterState<RoutesOf<Group>>,
    ): Effect.Effect<void, never, Registry> =>
      Effect.flatMap(
        Effect.sync(() => {
          currentState = next;
        }),
        () => Store.set(state, next),
      );

    const runMaybe = <A, E, R>(
      evaluate: () => MaybeEffect<A, E, R>,
    ): Effect.Effect<A, unknown, R> =>
      Effect.flatMap(
        Effect.try({
          try: evaluate,
          catch: (error) => error,
        }),
        (value) =>
          Effect.isEffect(value)
            ? (value as Effect.Effect<A, E, R>)
            : Effect.succeed(value as A),
      );

    const decodeSearch = <R extends Route.Any>(
      current: R,
      raw: RawSearch,
    ): Effect.Effect<Route.Search<R>, unknown, Route.Services<R>> => {
      const definition = current.options.search;
      if (definition === undefined) return Effect.succeed({} as Route.Search<R>);
      if (isSchemaCodec(definition)) {
        return Schema.decodeUnknownEffect(definition)(raw) as Effect.Effect<
          Route.Search<R>,
          unknown,
          Route.Services<R>
        >;
      }
      return runMaybe(() => definition.decode(raw)) as Effect.Effect<
        Route.Search<R>,
        unknown,
        Route.Services<R>
      >;
    };

    const parseParams = <R extends Route.Any>(
      current: R,
      raw: PathParams<Route.Path<R>>,
    ): Effect.Effect<Route.Params<R> | false, unknown, Route.Services<R>> => {
      const schema = current.options.params;
      if (schema !== undefined) {
        return Schema.decodeUnknownEffect(schema)(raw) as Effect.Effect<
          Route.Params<R> | false,
          unknown,
          Route.Services<R>
        >;
      }
      const parse = current.options.parseParams;
      if (parse === undefined) return Effect.succeed(raw as Route.Params<R>);
      return runMaybe(() => parse(raw)) as Effect.Effect<
        Route.Params<R> | false,
        unknown,
        Route.Services<R>
      >;
    };

    const resolveMatches = (
      location: ParsedLocation,
    ): Effect.Effect<ReadonlyArray<RouteMatch<RoutesOf<Group>>>, unknown, RouterServicesForGroup<Group>> =>
      Effect.gen(function* () {
        const pathname = stripBasepath(location.pathname, options.basepath);
        const exactMatches = compiled
          .map((compiledRoute) => ({ compiledRoute, match: compiledRoute.exact.exec(pathname) }))
          .filter(
            (
              item,
            ): item is {
              readonly compiledRoute: CompiledRoute<Route.Any>;
              readonly match: RegExpExecArray;
            } => item.match !== null,
          )
          .sort((a, b) => b.compiledRoute.score - a.compiledRoute.score);
        const leaf = exactMatches[0];
        if (leaf === undefined) return yield* Effect.fail(new NotFoundError({}));

        const branch = compiled
          .map((compiledRoute) => ({ compiledRoute, match: compiledRoute.prefix.exec(pathname) }))
          .filter(
            (
              item,
            ): item is {
              readonly compiledRoute: CompiledRoute<Route.Any>;
              readonly match: RegExpExecArray;
            } => item.match !== null,
          )
          .sort(
            (a, b) =>
              a.compiledRoute.length - b.compiledRoute.length ||
              a.compiledRoute.score - b.compiledRoute.score,
          );

        const matches: Array<RouteMatch<Route.Any>> = [];
        // Guard results accumulate parent-first down the branch; a guard
        // shared by several routes in the branch runs once per navigation.
        let provided: Record<string, unknown> = {};
        const ranGuards = new Set<AnyMiddleware>();
        for (const item of branch) {
          const rawParams = extractParams(item.compiledRoute, item.match);
          const params = yield* parseParams(item.compiledRoute.route, rawParams as never);
          if (params === false) continue;
          const routeSearch = yield* decodeSearch(item.compiledRoute.route, location.search);
          const routeContext: RouteContext<string, any, any> = {
            route: item.compiledRoute.route,
            location,
            params,
            search: routeSearch,
            path: item.compiledRoute.route.path,
          };
          // Guards run parent-first, before anything commits: a failure here
          // (RedirectError/NotFoundError) aborts the whole navigation.
          for (const middleware of item.compiledRoute.route.middlewares) {
            if (ranGuards.has(middleware)) continue;
            ranGuards.add(middleware);
            const handler = yield* middleware;
            const value = yield* handler(routeContext);
            if (value !== undefined && value !== null && typeof value === "object") {
              provided = { ...provided, ...value };
            }
          }
          const meta = item.compiledRoute.route.options.meta?.(routeContext) ?? [];
          const links = item.compiledRoute.route.options.links?.(routeContext) ?? [];
          matches.push({
            id: item.compiledRoute.route.id,
            route: item.compiledRoute.route,
            pathname: item.match[0] === "" ? "/" : item.match[0],
            params,
            search: routeSearch,
            provided,
            staticData: item.compiledRoute.route.options.staticData ?? {},
            meta,
            links,
            status: "success",
          });
        }
        if (!matches.some((match) => match.route === leaf.compiledRoute.route)) {
          return yield* Effect.fail(new NotFoundError({}));
        }
        return matches as unknown as ReadonlyArray<RouteMatch<RoutesOf<Group>>>;
      });

    const load = (
      location: ParsedLocation,
      displayLocation: ParsedLocation,
    ): Effect.Effect<ReadonlyArray<RouteMatch<RoutesOf<Group>>>, unknown, RouterServicesForGroup<Group> | Registry> =>
      Effect.gen(function* () {
        yield* setState({
          ...currentState,
          status: "pending",
          pendingLocation: displayLocation,
        });
        return yield* resolveMatches(location);
      });

    const encodeParams = (
      targetRoute: RoutesOf<Group>,
      params: unknown,
    ): Effect.Effect<PathParams<any>, unknown, RouterServicesForGroup<Group>> => {
      const source = params === true || params === undefined ? {} : params;
      const schema = targetRoute.options.params;
      if (schema !== undefined) {
        return Effect.map(
          Schema.encodeUnknownEffect(schema)(source),
          (encoded) => toPathParams(encoded),
        ) as Effect.Effect<PathParams<any>, unknown, RouterServicesForGroup<Group>>;
      }
      if (targetRoute.options.stringifyParams !== undefined) {
        return runMaybe(() => targetRoute.options.stringifyParams?.(source as never) ?? {}) as Effect.Effect<
          PathParams<any>,
          unknown,
          RouterServicesForGroup<Group>
        >;
      }
      return Effect.succeed(toPathParams(source));
    };

    const encodeSearch = (
      targetRoute: RoutesOf<Group>,
      searchInput: SearchRecord | true | ((current: RawSearch) => SearchRecord) | undefined,
    ): Effect.Effect<RawSearch, unknown, RouterServicesForGroup<Group>> => {
      if (searchInput === true) return Effect.succeed(currentState.location.search);
      const resolvedSearch = resolveSearchInput(searchInput, currentState.location.search);
      const definition = targetRoute.options.search;
      if (definition === undefined) return Effect.succeed(toRawSearch(resolvedSearch));
      if (isSchemaCodec(definition)) {
        return Effect.map(
          Schema.encodeUnknownEffect(definition)(resolvedSearch),
          (encoded) => toRawSearch(encoded),
        ) as Effect.Effect<RawSearch, unknown, RouterServicesForGroup<Group>>;
      }
      if (definition.encode === undefined) return Effect.succeed(toRawSearch(resolvedSearch));
      return Effect.succeed(definition.encode(resolvedSearch as never));
    };

    const buildLocationEffect = <const To extends RoutePath<RouterController<Group>>>(
      toOptions: ToOptions<RouterController<Group>, To>,
    ): Effect.Effect<ParsedLocation, unknown, RouterServicesForGroup<Group>> => Effect.gen(function* () {
      const foundRoute = routeGroup.routes.find((current) => current.path === toOptions.to);
      if (foundRoute === undefined) {
        return yield* Effect.fail(new Error(`Unitflow router cannot build unknown route "${String(toOptions.to)}".`));
      }
      const targetRoute = foundRoute as RoutesOf<Group>;
      const routeParams = yield* encodeParams(targetRoute, toOptions.params);
      const pathname = yield* Effect.try({
        try: () => addBasepath(interpolatePath(targetRoute.path, routeParams), options.basepath),
        catch: (error) => error,
      });
      const rawSearch = yield* encodeSearch(targetRoute, toOptions.search);
      const searchString = stringifySearch(rawSearch);
      const hash = toOptions.hash === true ? currentState.location.hash : toOptions.hash ?? "";
      return makeLocation(
        `${pathname}${searchString}${hash === "" ? "" : `#${hash}`}`,
        parseSearch,
        toOptions.state,
      );
    });

    const buildLocation = <const To extends RoutePath<RouterController<Group>>>(
      toOptions: ToOptions<RouterController<Group>, To>,
    ): ParsedLocation => {
      const exit = Effect.runSyncExit(
        buildLocationEffect(toOptions) as Effect.Effect<ParsedLocation, unknown>,
      );
      if (Exit.isSuccess(exit)) return exit.value;
      throw exitToError(exit);
    };

    const buildHref = <const To extends RoutePath<RouterController<Group>>>(
      toOptions: ToOptions<RouterController<Group>, To>,
    ): string => buildLocation(toOptions).href;

    const buildHrefEffect = <const To extends RoutePath<RouterController<Group>>>(
      toOptions: ToOptions<RouterController<Group>, To>,
    ): Effect.Effect<string, unknown, RouterServicesForGroup<Group>> =>
      Effect.map(buildLocationEffect(toOptions), (location) => location.href);

    const shouldBlock = (
      to: ParsedLocation,
      ignoreBlocker: boolean | undefined,
    ): Effect.Effect<boolean, unknown> =>
      Effect.gen(function* () {
        if (ignoreBlocker === true) return false;
        for (const blocker of blockers) {
          const blocked = yield* Effect.tryPromise({
            try: () => Promise.resolve(blocker({ from: currentState.location, to })),
            catch: (error) => error,
          });
          if (blocked) return true;
        }
        return false;
      });

    const handleError = (
      error: unknown,
      location?: ParsedLocation,
      resolvedLocation?: ParsedLocation,
    ): Effect.Effect<void, never, Registry> =>
      setState({
        status: isNotFoundError(error) ? "not-found" : "error",
        location: location ?? currentState.location,
        resolvedLocation: resolvedLocation ?? currentState.resolvedLocation,
        matches: location === undefined ? currentState.matches : [],
        error,
      });

    const commitLocation = (
      location: ParsedLocation,
    ): Effect.Effect<void, never, RouterServicesForGroup<Group> | Registry> =>
      Effect.exit(load(location, location)).pipe(
        Effect.flatMap((exit) => {
          if (Exit.isSuccess(exit)) {
            return setState({
              status: "success",
              location,
              resolvedLocation: location,
              matches: exit.value,
            });
          }
          const error = exitToError(exit);
          // A middleware redirect on the initial load or a history pop
          // follows through instead of surfacing as an error state.
          if (isRedirectError(error)) {
            return navigate({ ...error.options, replace: true } as never);
          }
          return handleError(error, location, location);
        }),
      );

    const navigate = <const To extends RoutePath<RouterController<Group>>>(
      navigateOptions: NavigateOptions<RouterController<Group>, To>,
    ): Effect.Effect<void, never, RouterServicesForGroup<Group> | Registry> =>
      Effect.gen(function* () {
        const resolvedLocationExit = yield* Effect.exit(buildLocationEffect(navigateOptions));
        if (Exit.isFailure(resolvedLocationExit)) {
          yield* handleError(exitToError(resolvedLocationExit));
          return;
        }
        const resolvedLocation = resolvedLocationExit.value;
        const displayLocationExit =
          navigateOptions.mask === undefined
            ? Exit.succeed(resolvedLocation)
            : yield* Effect.exit(buildLocationEffect(navigateOptions.mask as never));
        if (Exit.isFailure(displayLocationExit)) {
          yield* handleError(exitToError(displayLocationExit));
          return;
        }
        const displayLocation = displayLocationExit.value;
        const blockedExit = yield* Effect.exit(
          shouldBlock(displayLocation, navigateOptions.ignoreBlocker),
        );
        if (Exit.isFailure(blockedExit)) {
          yield* handleError(exitToError(blockedExit));
          return;
        }
        if (blockedExit.value) return;
        if (navigateOptions.reloadDocument === true && typeof window !== "undefined") {
          window.location.assign(displayLocation.href);
          return;
        }
        const exit = yield* Effect.exit(load(resolvedLocation, displayLocation));
        if (Exit.isSuccess(exit)) {
          ignoreNextHistory = true;
          if (navigateOptions.replace === true) history.replace(displayLocation.href, displayLocation.state);
          else history.push(displayLocation.href, displayLocation.state);
          yield* setState({
            status: "success",
            location: displayLocation,
            resolvedLocation,
            matches: exit.value,
          });
          if (navigateOptions.resetScroll !== false && typeof window !== "undefined") {
            window.scrollTo(0, 0);
          }
          return;
        }
        const error = exitToError(exit);
        if (isRedirectError(error)) {
          yield* navigate({ ...error.options, replace: true } as never);
          return;
        }
        yield* handleError(error);
      });

    const matchRoute = <const To extends RoutePath<RouterController<Group>>>(
      matchOptions: ToOptions<RouterController<Group>, To> & ActiveOptions,
    ): boolean => {
      const location = buildLocation(matchOptions);
      const current = currentState.resolvedLocation;
      const pathMatches =
        matchOptions.exact === true
          ? current.pathname === location.pathname
          : current.pathname === location.pathname ||
            current.pathname.startsWith(`${trimRight(location.pathname)}/`);
      if (!pathMatches) return false;
      if (matchOptions.includeHash === true && current.hash !== location.hash) return false;
      if (matchOptions.includeSearch === true && !searchEquals(current.search, location.search)) return false;
      return true;
    };

    const addBlocker = (blocker: Blocker): Effect.Effect<void> =>
      Effect.sync(() => {
        blockers.add(blocker);
      });

    const removeBlocker = (blocker: Blocker): Effect.Effect<void> =>
      Effect.sync(() => {
        blockers.delete(blocker);
      });

    const dispose = (): Effect.Effect<void> =>
      Effect.sync(() => {
        disposed = true;
        blockers.clear();
      });

    const controller: RouterController<Group> = {
      group: routeGroup,
      routes: routeGroup.routes as unknown as ReadonlyArray<RoutesOf<Group>>,
      options,
      history,
      buildLocation,
      buildHref,
      buildLocationEffect,
      buildHrefEffect,
      matchRoute,
    };

    const navigateEvent = yield* Event.make<
      NavigateOptions<RouterController<Group>, RoutePath<RouterController<Group>>>
    >({ name: "router.navigate" }).pipe(Event.handler((payload) => navigate(payload as never)));
    const addBlockerEvent = yield* Event.make<Blocker>({ name: "router.addBlocker" }).pipe(
      Event.handler((blocker) => addBlocker(blocker)),
    );
    const removeBlockerEvent = yield* Event.make<Blocker>({ name: "router.removeBlocker" }).pipe(
      Event.handler((blocker) => removeBlocker(blocker)),
    );

    const location = Store.combine([state], (value) => value.location, {
      name: "router.location",
    });
    const matches = Store.combine([state], (value) => value.matches, {
      name: "router.matches",
    });
    const api = Store.make(controller, { name: "router.api" });

    const historyChanged = yield* Event.make<ParsedLocation>({ name: "router.historyChanged" }).pipe(
      Event.handler((nextLocation) => (disposed ? Effect.void : commitLocation(nextLocation))),
    );
    const registry = yield* Registry;
    const historyChannel = yield* Event.pubsub(historyChanged);
    const unsubscribeHistory = history.subscribe((nextLocation) => {
      if (ignoreNextHistory) {
        ignoreNextHistory = false;
        return;
      }
      trackPublish(registry, historyChanged.id);
      PubSub.publishUnsafe(historyChannel, nextLocation);
    });
    yield* Effect.addFinalizer(() =>
      Effect.flatMap(
        Effect.sync(() => {
          unsubscribeHistory();
        }),
        () => dispose(),
      ),
    );

    yield* commitLocation(history.location);

    return {
      inputs: {
        navigate: navigateEvent,
        addBlocker: addBlockerEvent,
        removeBlocker: removeBlockerEvent,
      },
      outputs: {
        state,
        location,
        matches,
        api,
      },
      ui: {
        state,
        location,
        matches,
        navigate: navigateEvent,
        api,
      },
    };
  }) as Effect.Effect<RouterShape<Group>, never, RouterServicesForGroup<Group> | History | Registry>);

const exitToError = (exit: Exit.Exit<unknown, unknown>): unknown => {
  if (Exit.isSuccess(exit)) return undefined;
  const failure = exit.cause.reasons.find(Cause.isFailReason);
  return failure === undefined ? exit.cause : failure.error;
};

const getController = <M extends AnyRouter>(
  router: M,
): Effect.Effect<RouterControllerOf<M>, never, Context.Service.Identifier<M> | Registry> =>
  (Effect.gen(function* () {
    const ports = yield* (Model.get(router as AnyRouter) as Effect.Effect<
      Model.PortsOf<M>,
      never,
      Context.Service.Identifier<M>
    >);
    return yield* Store.get(ports.outputs.api);
  }) as unknown as Effect.Effect<RouterControllerOf<M>, never, Context.Service.Identifier<M> | Registry>);

export const createMemoryHistory = (options?: {
  readonly initialEntries?: ReadonlyArray<string>;
  readonly parseSearch?: (search: string) => RawSearch;
}): RouterHistory => {
  const parseSearch = options?.parseSearch ?? defaultParseSearch;
  const entries = options?.initialEntries?.length ? [...options.initialEntries] : ["/"];
  let index = 0;
  let current = makeLocation(entries[index] ?? "/", parseSearch);
  const listeners = new Set<(location: ParsedLocation) => void>();
  const notify = (): void => {
    for (const listener of listeners) listener(current);
  };
  return {
    get location() {
      return current;
    },
    push(href, state) {
      entries.splice(index + 1, entries.length - index - 1, href);
      index += 1;
      current = makeLocation(href, parseSearch, state);
      notify();
    },
    replace(href, state) {
      entries[index] = href;
      current = makeLocation(href, parseSearch, state);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const createBrowserHistory = (options?: {
  readonly parseSearch?: (search: string) => RawSearch;
}): RouterHistory => {
  if (typeof window === "undefined") return createMemoryHistory(options);
  const parseSearch = options?.parseSearch ?? defaultParseSearch;
  let current = makeLocation(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
    parseSearch,
    window.history.state,
  );
  const listeners = new Set<(location: ParsedLocation) => void>();
  const notify = (): void => {
    for (const listener of listeners) listener(current);
  };
  const onPopState = (event: PopStateEvent): void => {
    current = makeLocation(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
      parseSearch,
      event.state,
    );
    notify();
  };
  window.addEventListener("popstate", onPopState);
  return {
    get location() {
      return current;
    },
    push(href, state) {
      window.history.pushState(state, "", href);
      current = makeLocation(href, parseSearch, state);
      notify();
    },
    replace(href, state) {
      window.history.replaceState(state, "", href);
      current = makeLocation(href, parseSearch, state);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("popstate", onPopState);
      };
    },
  };
};

export const createHashHistory = (options?: {
  readonly parseSearch?: (search: string) => RawSearch;
}): RouterHistory => {
  if (typeof window === "undefined") return createMemoryHistory(options);
  const parseSearch = options?.parseSearch ?? defaultParseSearch;
  const read = (): ParsedLocation => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    return makeLocation(hash === "" ? "/" : hash, parseSearch, window.history.state);
  };
  let current = read();
  const listeners = new Set<(location: ParsedLocation) => void>();
  const notify = (): void => {
    for (const listener of listeners) listener(current);
  };
  const onHashChange = (): void => {
    current = read();
    notify();
  };
  window.addEventListener("hashchange", onHashChange);
  return {
    get location() {
      return current;
    },
    push(href, state) {
      window.history.pushState(state, "", `#${href}`);
      current = makeLocation(href, parseSearch, state);
      notify();
    },
    replace(href, state) {
      window.history.replaceState(state, "", `#${href}`);
      current = makeLocation(href, parseSearch, state);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("hashchange", onHashChange);
      };
    },
  };
};

export const defaultParseSearch = (searchString: string): RawSearch => {
  const params = new URLSearchParams(searchString.startsWith("?") ? searchString.slice(1) : searchString);
  const out: Record<string, string | ReadonlyArray<string> | undefined> = {};
  for (const [key, value] of params) {
    const decoded = decodeSearchValue(value);
    const existing = out[key];
    if (existing === undefined) out[key] = decoded;
    else out[key] = Array.isArray(existing) ? [...existing, decoded] : [existing, decoded];
  }
  return out;
};

export const defaultStringifySearch = (searchRecord: SearchRecord): string => {
  const params = new URLSearchParams();
  const append = (key: string, value: unknown): void => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) append(key, item);
      return;
    }
    params.append(key, encodeSearchValue(value));
  };
  for (const key of Object.keys(searchRecord).sort()) append(key, searchRecord[key]);
  const stringified = params.toString();
  return stringified === "" ? "" : `?${stringified}`;
};

const isSchemaCodec = (value: unknown): value is AnySchemaCodec =>
  typeof value === "object" && value !== null && "ast" in value && !("decode" in value);

const toRawSearch = (value: unknown): RawSearch => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: Record<string, string | ReadonlyArray<string> | undefined> = {};
  for (const [key, item] of Object.entries(record)) {
    if (item === undefined) {
      out[key] = undefined;
    } else if (Array.isArray(item)) {
      out[key] = item.map((entry) => String(entry));
    } else {
      out[key] = String(item);
    }
  }
  return out;
};

const toPathParams = (value: unknown): Record<string, string> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (item !== undefined && item !== null) out[key] = String(item);
  }
  return out;
};

const decodeSearchValue = (value: string): string => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
};

const encodeSearchValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
};

const makeLocation = (
  href: string,
  parseSearch: (search: string) => RawSearch,
  state?: unknown,
): ParsedLocation => {
  const url = new URL(href, "http://unitflow.local");
  const pathname = normalizePath(url.pathname);
  const searchString = url.search;
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return {
    pathname,
    search: parseSearch(searchString),
    searchString,
    hash,
    href: `${pathname}${searchString}${hash === "" ? "" : `#${hash}`}`,
    state,
  };
};

const normalizePath = (path: string): string => {
  if (path === "") return "/";
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
};

const trimRight = (path: string): string =>
  path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

const joinPaths = (prefixPath: string, path: string): string => {
  const left = normalizePath(prefixPath);
  const right = normalizePath(path);
  if (left === "/") return right;
  if (right === "/") return left;
  return `${trimRight(left)}${right}`;
};

const addBasepath = (path: string, basepath: string | undefined): string =>
  basepath === undefined || basepath === "/" ? path : joinPaths(basepath, path);

const stripBasepath = (path: string, basepath: string | undefined): string => {
  if (basepath === undefined || basepath === "/") return path;
  const normalized = normalizePath(basepath);
  return path === normalized ? "/" : path.startsWith(`${normalized}/`) ? path.slice(normalized.length) : path;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const compileRoute = <R extends Route.Any>(current: R): CompiledRoute<R> => {
  const path = normalizePath(current.path);
  if (path === "/") {
    return {
      route: current,
      exact: /^\/?$/,
      prefix: /^\//,
      paramNames: [],
      score: 0,
      length: 0,
    };
  }
  const segments = path.slice(1).split("/");
  const paramNames: Array<{ name: string; optional: boolean }> = [];
  let pattern = "^";
  let score = 0;
  for (const segment of segments) {
    if (segment.startsWith(":")) {
      const optional = segment.endsWith("?");
      const name = segment.slice(1, optional ? -1 : undefined);
      paramNames.push({ name, optional });
      pattern += optional ? "(?:/([^/]+))?" : "/([^/]+)";
      score += optional ? 3 : 5;
    } else if (segment.startsWith("*")) {
      const name = segment.slice(1) || "_splat";
      paramNames.push({ name, optional: false });
      pattern += "/(.*)";
      score += 1;
    } else {
      pattern += `/${escapeRegex(segment)}`;
      score += 10;
    }
  }
  const flags = current.options.caseSensitive === true ? "" : "i";
  return {
    route: current,
    exact: new RegExp(`${pattern}/?$`, flags),
    prefix: new RegExp(`${pattern}(?=/|$)`, flags),
    paramNames,
    score: score + segments.length,
    length: segments.length,
  };
};

const extractParams = (
  compiled: CompiledRoute<Route.Any>,
  match: RegExpExecArray,
): Record<string, string> => {
  const params: Record<string, string> = {};
  compiled.paramNames.forEach((param, index) => {
    const value = match[index + 1];
    if (value !== undefined) params[param.name] = decodeURIComponent(value);
  });
  return params;
};

const interpolatePath = (path: string, params: unknown): string => {
  const source = (params ?? {}) as Record<string, unknown>;
  const segments = normalizePath(path).split("/");
  const out: Array<string> = [];
  for (const segment of segments) {
    if (segment === "") continue;
    if (segment.startsWith(":")) {
      const optional = segment.endsWith("?");
      const name = segment.slice(1, optional ? -1 : undefined);
      const value = source[name];
      if (value === undefined || value === null) {
        if (optional) continue;
        throw new Error(`Unitflow router missing path param "${name}" for "${path}".`);
      }
      out.push(encodeURIComponent(String(value)));
    } else if (segment.startsWith("*")) {
      const name = segment.slice(1) || "_splat";
      const value = source[name];
      if (value === undefined || value === null) {
        throw new Error(`Unitflow router missing splat param "${name}" for "${path}".`);
      }
      out.push(String(value).split("/").map(encodeURIComponent).join("/"));
    } else {
      out.push(segment);
    }
  }
  return out.length === 0 ? "/" : `/${out.join("/")}`;
};

const resolveSearchInput = (
  searchInput: SearchRecord | true | ((current: RawSearch) => SearchRecord) | undefined,
  current: RawSearch,
): SearchRecord => {
  if (searchInput === undefined) return {};
  if (searchInput === true) return current;
  return typeof searchInput === "function" ? searchInput(current) : searchInput;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

const searchEquals = (a: RawSearch, b: RawSearch): boolean => stableStringify(a) === stableStringify(b);
