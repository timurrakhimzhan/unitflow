import { Event, Model, Store } from "@unitflow/core";
import { InstanceScope, Registry } from "@unitflow/core/registry";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { ParseOptions } from "effect/SchemaAST";
import type { Concurrency } from "effect/Types";

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
 * dependencies) live in the layer `layer` builds, composed at the feature
 * level. Attaching an inline function instead would leak every guard's
 * services into the router's own requirements.
 *
 * `MiddlewareHandler` has no requirements channel — a guard reading live
 * Unitflow state (`Store.get`, `Model.get`, ...) needs SOME services on
 * every call, not just once. `layer` resolves the handler's services once at
 * layer build and captures them, so the stored handler stays dependency-free
 * while still running fresh Effect code (reactive reads included) per call:
 *
 * ```ts
 * class AuthGuard extends Router.Middleware<AuthGuard>()("app/AuthGuard") {}
 * const AuthGuardLive = AuthGuard.layer((ctx) => Effect.gen(function* () {
 *   const session = yield* Model.get(SessionModel);
 *   const user = yield* Store.get(session.outputs.user); // read fresh, every navigation
 *   if (Option.isNone(user)) return yield* Effect.fail(new Router.RedirectError({ options: { to: "/login" } }));
 * }));
 * ```
 *
 * For a guard with no per-call reactive reads, a plain `Layer.effect(Tag, ...)`
 * works too — `layer` only earns its keep once the handler needs to see
 * fresh state on every navigation, not just what was true at layer build.
 */
export interface MiddlewareClass<Self, Id extends string, Provides = void>
  extends Context.ServiceClass<Self, Id, MiddlewareHandler<Provides>> {
  /** Type-level only: what the guard provides to the routes it protects. */
  readonly "~provides": Provides;
  /** Builds the implementation layer. The handler's services are resolved
   * once at layer build and captured, so the stored handler itself is
   * dependency-free — the router only ever requires the tag. */
  readonly layer: <R = never>(
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
      static readonly layer = <R = never>(
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
  /** How this route's OWN `middlewares` run against each other — sequential
   * (`undefined`, the default) preserves today's one-at-a-time order;
   * `"unbounded"`/a number lets independent guards (e.g. a session check and
   * an unrelated preload) run concurrently. Guards across DIFFERENT levels
   * of the matched branch still run parent-first, in order — this only
   * affects the guards attached to ONE route (or one `Route.group(...)`). */
  readonly middlewaresConcurrency?: Concurrency;
  /** `true` only for `Route.layout`'s implicit parent: contributes no path
   * segment, can never be a leaf/exact match — distinct from `path: "/"`
   * (which is a real, navigable root) even though both normalize to `"/"`. */
  readonly pathless?: boolean;
  /** The id of the route this one was explicitly attached under — via
   * `Route.addChild` on the parent, or implicitly via `Route.layout`'s
   * pathless grouping parent. `undefined` for a route with no declared
   * parent: it matches only itself, never becomes an accidental ancestor of
   * an unrelated route that happens to share a literal path prefix. */
  readonly parentId?: string;
  /** Children declared on this route via `Route.addChild`, not yet
   * expanded into the flat list `Route.group(...)` compiles from. */
  readonly children: ReadonlyArray<Route.Any>;
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
  /** What the matched branch's middlewares provide, merged — named `Output`
   * (not `Provided`) to read symmetrically with a model's own `inputs`:
   * a page model's `inputs.user` matches a route whose `Route.Output<R>`
   * has a `user` field of the same type. */
  export type Output<R extends Any> = R["~types"]["provided"];
  export type Error<R extends Any> = R["~types"]["error"];
  export type Services<R extends Any> = R["~types"]["services"];
  /** The FULLY FLATTENED set of routes `Route.addChild` attached under `R`,
   * at any depth — carried as a phantom `"~children"` marker INTERSECTED
   * onto `R`'s type (not one of `Route<>`'s own type parameters, kept out
   * of the core interface so `Route.Any` stays the simple type every other
   * conditional type here already builds on). `WithChild` bakes a child's
   * OWN already-flattened closure in at EACH `addChild` call (bottom-up),
   * so reading this is a single non-recursive extraction, not a recursive
   * walk — a recursive `Descendants<R>` was tried and blew up `tsc`
   * (TS2589) once anything opaque (`Route.Any` itself, or a fully generic
   * unresolved type parameter behind `AnyRouteGroup`) reached it. Plain
   * routes never declare this property, so the check below fails structural
   * assignability and falls through to `readonly []`. */
  export type Children<R> = R extends { readonly "~children": infer C extends ReadonlyArray<Any> }
    ? C
    : readonly [];
  /** Alias of {@link Children}: already the full flattened descendant set by
   * construction (see `WithChild`), not computed by recursing here. */
  export type Descendants<R> = Children<R>[number];
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
  children: [],
  "~types": undefined as unknown as Route<Id, Path, ParamsSchema, Search>["~types"],
});

/** `PrefixedRoute` applied to every member of a tuple, preserving its
 * length/order (a homomorphic mapped tuple type) — used to re-root a whole
 * already-flattened subtree (a child's own previously-attached descendants)
 * under a NEW ancestor's path, mirroring what `flattenRoute` does to the
 * VALUE at runtime by threading the accumulated prefix down. */
export type PrefixedTuple<T extends ReadonlyArray<Route.Any>, Prefix extends string> = {
  readonly [K in keyof T]: PrefixedRoute<T[K], Prefix>;
};

// `Omit<R, "~children">` first: R may already carry a marker from an
// earlier `.pipe(Route.addChild(...))` in the same chain — intersecting a
// SECOND "~children" property on top of that (rather than replacing it)
// would type it as `OldTuple & NewTuple`, not the union `Descendants` needs.
// `Child` (and its own already-attached descendants) get `Route.Path<R>`
// joined in, matching the runtime path-joining `flattenRoute` performs.
export type WithChild<R extends Route.Any, Child extends Route.Any> = Omit<R, "~children"> & {
  readonly "~children": readonly [
    ...Route.Children<R>,
    PrefixedRoute<Child, Route.Path<R>>,
    ...PrefixedTuple<Route.Children<Child>, Route.Path<R>>,
  ];
};

/** Declares `child` as nested under `self`: `child`'s path is rewritten to
 * join under `self`'s own path (reuses the same `joinPaths` composition
 * `.prefix()` already uses), and `child.parentId` is set to `self.id`.
 * Opt-in only — a route with no `addChild` calls has no children, so two
 * routes whose paths happen to share a literal prefix never nest unless
 * this was called explicitly. Chainable: `.pipe(Route.addChild(A),
 * Route.addChild(B))`. */
export const addChild =
  <Child extends Route.Any>(child: Child) =>
  <Self extends Route.Any>(self: Self): WithChild<Self, Child> => {
    // Path-joining happens ONCE, bottom-up, in `flattenRoute` — not here.
    // `child` may itself already have grandchildren attached (an earlier
    // `.addChild` on `child`); if this function eagerly joined `self.path`
    // into just `child`'s own path, those grandchildren's paths (already
    // baked relative to `child`'s ORIGINAL, pre-attachment path) would never
    // learn about `self`'s prefix. Deferring to `flattenRoute`, which
    // threads the accumulated prefix down through the whole tree, keeps
    // every depth correct regardless of attachment order.
    const linkedChild: Route.Any = { ...child, parentId: self.id };
    return {
      ...self,
      children: [...self.children, linkedChild],
    } as unknown as WithChild<Self, Child>;
  };

export type PrefixedRoute<R extends Route.Any, Prefix extends string> = R extends Route<
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

export type WithMiddleware<R extends Route.Any, M extends AnyMiddleware> = R extends Route<
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
  /** Sets how EACH route's own middlewares run against each other — see
   * {@link Route.middlewaresConcurrency}. Applies to every route currently
   * in the group, independently (still parent-first across route levels). */
  middlewaresConcurrency(concurrency: Concurrency): RouteGroup<R>;
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
  middlewaresConcurrency(this: AnyRouteGroup, concurrency: Concurrency) {
    return group(...this.routes.map((current) => ({ ...current, middlewaresConcurrency: concurrency })));
  },
};

/** Flattens a route declared with `.addChild(...)` into itself plus every
 * declared descendant (recursively — a child may have its own children),
 * each already carrying its `parentId`. A route with no children flattens
 * to just itself. */
const flattenRoute = (current: Route.Any, prefix = ""): ReadonlyArray<Route.Any> => {
  // Pathless (`Route.layout`) parents contribute no URL segment of their
  // own — skip through them unchanged, threading the SAME prefix to their
  // members, instead of joining against their placeholder `path: ""`.
  if (current.pathless === true) {
    return [
      { ...current, children: [] },
      ...current.children.flatMap((child) => flattenRoute(child, prefix)),
    ];
  }
  const path = joinPaths(prefix, current.path);
  return [
    { ...current, path, options: { ...current.options, path }, children: [] },
    ...current.children.flatMap((child) => flattenRoute(child, path)),
  ];
};

/** Builds a `RouteGroup` from top-level route arguments, widening each
 * argument's type into itself PLUS every route `Route.addChild` attached
 * under it (at any depth) — matching what `flattenRoute` does to the VALUE
 * at runtime, so a route table built from one `.addChild`-composed parent
 * exposes every descendant's id/path to `RoutePath`/`RouteIds` and friends,
 * not just the parent passed in directly. */
export const group = <const Routes extends ReadonlyArray<Route.Any>>(
  ...routes: Routes
): RouteGroup<Routes[number] | Route.Descendants<Routes[number]>> =>
  Object.assign(Object.create(PipeableProto), RouteGroupProto, {
    [RouteGroupTypeId]: RouteGroupTypeId,
    routes: routes.flatMap((current) => flattenRoute(current)),
  });

export const makeGroup = group;

export const add = <const Routes extends ReadonlyArray<Route.Any>>(
  ...routes: Routes
): RouteGroup<Routes[number] | Route.Descendants<Routes[number]>> => group(...routes);

export const merge = <const Groups extends ReadonlyArray<AnyRouteGroup>>(
  ...groups: Groups
): RouteGroup<RoutesOf<Groups[number]>> =>
  group(...groups.flatMap((current) => current.routes)) as RouteGroup<RoutesOf<Groups[number]>>;

/** The members `Route.layout` wraps: `self`'s own type if it's a single
 * `Route`, otherwise the group's member union — in both cases WITHOUT its
 * `Route.Descendants` yet, `layout`'s own return type widens that in. */
export type MembersOf<Self extends AnyRouteGroup | Route.Any> = Self extends Route.Any
  ? Self
  : RoutesOf<Self>;

/** Wraps `self` (a route, or a group of routes) under an implicit pathless
 * parent with the given id — a shared rendering/guard-scope wrapper for
 * *independent* siblings that aren't the same resource (unlike
 * `Route.addChild`, which is for one route that genuinely owns a child's
 * content). The parent contributes no path segment of its own. */
export const layout =
  <const Id extends string>(id: Id) =>
  <Self extends AnyRouteGroup | Route.Any>(
    self: Self,
  ): RouteGroup<
    Route<Id, "", undefined, undefined> | MembersOf<Self> | Route.Descendants<MembersOf<Self>>
  > => {
    const members = isRoute(self) ? [self as Route.Any] : (self as AnyRouteGroup).routes;
    const parent: Route.Any = {
      ...PipeableProto,
      [RouteTypeId]: RouteTypeId,
      id,
      path: "",
      options: { path: "" },
      middlewares: [],
      children: [],
      pathless: true,
      // eslint-disable-next-line revizo/no-type-assertion
      "~types": undefined as never,
    };
    const linkedMembers = members.map((member) => ({ ...member, parentId: id }));
    // eslint-disable-next-line revizo/no-type-assertion
    return group(parent, ...linkedMembers) as never;
  };

/** Attaches a middleware TAG to `self` (a route, or every route currently in
 * a group). With explicit parent-child hierarchy, attaching to a shared
 * parent (`Route.layout`'s implicit parent, or any `Route.addChild` owner)
 * is usually enough — `resolveMatches` walks the ancestor chain and runs an
 * ancestor's middlewares for every descendant navigation, so a group-wide
 * attach is only needed for independent routes with no shared parent. */
export const middleware =
  <M extends AnyMiddleware>(mw: M) =>
  <Self extends AnyRouteGroup | Route.Any>(self: Self): Self extends AnyRouteGroup ? RouteGroup<WithMiddleware<RoutesOf<Self>, M>> : WithMiddleware<Self & Route.Any, M> =>
    (isRoute(self)
      ? { ...self, middlewares: [...(self as Route.Any).middlewares, mw] }
      : (self as AnyRouteGroup).middleware(mw)) as never;

export const prefix =
  <const Prefix extends string>(path: Prefix) =>
  <Group extends AnyRouteGroup>(routeGroup: Group): RouteGroup<PrefixedRoute<RoutesOf<Group>, Prefix>> =>
    routeGroup.prefix(path) as unknown as RouteGroup<PrefixedRoute<RoutesOf<Group>, Prefix>>;

/** Sets how a route's (or every route currently in a group's) OWN
 * middlewares run against each other — sequential by default, so two
 * independent guards (say a session check and an unrelated data preload)
 * can run concurrently instead of one after the other. Guards across
 * DIFFERENT levels of the matched branch (parent vs. child route) still
 * always run parent-first, in order — this only affects middlewares
 * attached to the SAME route/group. */
export const middlewaresConcurrency =
  (concurrency: Concurrency) =>
  <Self extends AnyRouteGroup | Route.Any>(self: Self): Self =>
    (isRoute(self)
      ? { ...self, middlewaresConcurrency: concurrency }
      : (self as AnyRouteGroup).middlewaresConcurrency(concurrency)) as Self;

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
  readonly provided: Route.Output<R>;
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
    readonly navigate: Event.InputSource<
      NavigateOptions<RouterController<Group>, RoutePath<RouterController<Group>>>
    >;
    readonly addBlocker: Event.InputSource<Blocker>;
    readonly removeBlocker: Event.InputSource<Blocker>;
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
    readonly navigate: Event.InputSource<
      NavigateOptions<RouterController<Group>, RoutePath<RouterController<Group>>>
    >;
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
    readonly provided: Store.Combined<Option.Option<Route.Output<R>>>;
  };
  readonly ui: {
    readonly opened: Store.Combined<boolean>;
    readonly params: Store.Combined<Option.Option<Route.Params<R>>>;
    readonly search: Store.Combined<Option.Option<Route.Search<R>>>;
    readonly provided: Store.Combined<Option.Option<Route.Output<R>>>;
  };
}

export type RouteIds<Group extends AnyRouteGroup> = Route.Id<RoutesOf<Group>>;

/** The per-key shape map of {@link RouteModel}: each route id maps to the
 * unit shape of THAT route, so `Model.get(router.routes, "user")` comes back
 * with `params`/`search` typed by the "user" route's schemas. */
export type RouteShapes<Group extends AnyRouteGroup> = {
  readonly [Id in RouteIds<Group>]: RouteUnitShape<Extract<RoutesOf<Group>, { readonly id: Id }>>;
};

/** The page-model map handed to `router.pages(...)`: keys are the router's
 * route ids (a typo will not compile), values are the page models. Declared
 * AFTER the models — never on the route — because a route referencing its
 * model while the model reads `router.routes` is a type-inference cycle.
 *
 * Values are `Model.Singleton` on purpose: `makePages` leases each one with
 * `Model.get(pageModel)`, no key. A keyed page model has nowhere to receive
 * one here — page data is meant to be gated on the route's own ports
 * (`params`/`search`/`opened`), not on the page model's key. Wrap a keyed
 * model in a singleton that leases it with the fixed key it needs. */
export type PageMap<Group extends AnyRouteGroup> = {
  readonly [Id in RouteIds<Group>]?: Model.Singleton;
};

type PageServicesOfMap<Pages> = {
  [K in keyof Pages]-?: Pages[K] extends Model.AnyService
    ? Context.Service.Identifier<Pages[K]>
    : never;
}[keyof Pages];

/** The shape of a pages model: the router's own unit plus one unit per
 * mapped page model. */
export interface PagesShape<Pages> extends Model.Shape {
  readonly inputs: Record<never, never>;
  readonly outputs: Record<never, never>;
  readonly ui: {
    /** The router's own unit. Typed opaquely ON PURPOSE: naming the precise
     * ports here closes a resolution cycle (PagesShape -> RouterShape ->
     * NavigateOptions -> AnyRouter -> RouterModel). RouterView re-types it
     * internally from the router value it already holds. */
    readonly router: Model.UnitPorts;
  } & {
    // The UnitPorts intersection keeps the mapped entry inside the `ui`
    // section's port contract even for erased (`any`) page maps.
    readonly [K in keyof Pages as Pages[K] extends Model.AnyService
      ? K & string
      : never]: Pages[K] extends Model.AnyService
      ? Model.PortsOf<Pages[K]> & Model.UnitPorts
      : never;
  };
}

/** The singleton `router.pages(map)` returns: leases the router and every
 * mapped page model, republishing their units through `ui`. Owning them
 * HERE (not inside route units) keeps construction acyclic — page models
 * may freely read `router.routes` units. */
export interface PagesModel<
  Id extends string = string,
  Group extends AnyRouteGroup = AnyRouteGroup,
  Pages extends PageMap<Group> = PageMap<Group>,
> extends Model.ServiceClass<
    PagesModel<Id, Group, Pages>,
    `${Id}/pages`,
    void,
    PagesShape<Pages>,
    never,
    RouterModel<Id, Group> | PageServicesOfMap<Pages> | Registry
  > {
  /** The router value this pages model was created from — RouterView binds
   * its inner view through it. Typed opaquely (the precise type would close
   * the ToOptions resolution cycle); RouterView re-types it internally. */
  readonly router: Model.AnyService;
}

export type AnyPagesModel = PagesModel<any, any, any>;

/** The keyed model behind `router.routes`: one unit per route id, derived
 * from the router's `outputs.matches`. */
export interface RouteModel<
  Id extends string = string,
  Group extends AnyRouteGroup = AnyRouteGroup,
> extends Model.ServiceClass<
    RouteModel<Id, Group>,
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
export type RouterIdOf<TRouter> = TRouter extends RouterModel<infer Id, any> ? Id : never;

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

/** A raw href, not one of the router's registered route templates — no
 * `params`/`search` to type-check against a schema that doesn't apply. The
 * companion to the typed member below: together they let `navigate`/`Link`
 * accept either a known route (typed, autocompleted) or an arbitrary string
 * (e.g. a redirect target stashed as `?redirect=<href>`), matching the same
 * "known union member or plain string" shape TanStack Router's own `to`
 * typing uses. */
export interface RawToOptions {
  readonly to: string & {};
  readonly hash?: string | true;
  readonly state?: unknown;
  readonly params?: never;
  readonly search?: never;
}

export type ToOptions<TRouter extends AnyRouter | AnyRouterController, To extends RoutePath<TRouter>> =
  | ({
      readonly to: To;
      readonly hash?: string | true;
      readonly state?: unknown;
    } & PathParamOptions<PathParamsFor<TRouter, To>> &
      SearchParamOptions<SearchInputFor<TRouter, To>>)
  | RawToOptions;

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
  /** Used only to isolate an ALREADY-KNOWN ancestor's own params from a
   * longer pathname (the leaf's) — never to discover ancestors: branch
   * membership comes from `route.parentId`, not from filtering the whole
   * route list by this pattern. */
  readonly prefix: RegExp;
  readonly paramNames: ReadonlyArray<{ readonly name: string; readonly optional: boolean }>;
  readonly score: number;
  readonly length: number;
}

/** Location helpers attached to the router value itself
 * (`AppRouter.buildHref({...})`). A separate interface intersected onto
 * {@link RouterModel} at `make` — declared inside RouterModel these method
 * signatures close a resolution cycle (param -> ToOptions -> AnyRouter ->
 * RouterModel -> param) that the ServiceClass heritage forces TypeScript to
 * evaluate eagerly. */
export interface RouterTargets<Id extends string, Group extends AnyRouteGroup> {
  /** Builds a location for a route target without navigating. */
  readonly buildLocation: <const To extends RoutePath<RouterController<Group>>>(
    options: ToOptions<RouterController<Group>, To>,
  ) => Effect.Effect<
    ParsedLocation,
    unknown,
    RouterModel<Id, Group> | Registry | RouterServicesForGroup<Group>
  >;
  /** Builds an href string for a route target without navigating. */
  readonly buildHref: <const To extends RoutePath<RouterController<Group>>>(
    options: ToOptions<RouterController<Group>, To>,
  ) => Effect.Effect<
    string,
    unknown,
    RouterModel<Id, Group> | Registry | RouterServicesForGroup<Group>
  >;
}

/** What `Router.make(...)` returns: one value instead of a `NavigationModel`/
 * `RouteModel` pair the app had to name and compose separately. `model`
 * (the engine — navigation, current location, `buildHref`/`buildLocation`)
 * and `routeModel` (the keyed per-route unit) are the same two `Model.get`
 * targets as before, just nested — `model`/`routeModel` are plain fields,
 * not the identifiers of their own types (`RouterModel`/`RouteModel`),
 * exactly like the existing `routes` value / `RouteModel<...>` type pairing
 * already has. `layer` is `routeModel.layer` merged with `model.layer` —
 * `routeModel`'s own `make` already leases `model`, so this is the same
 * composition apps previously wrote by hand at the call site. */
export interface AppRouter<Id extends string, Group extends AnyRouteGroup> {
  readonly model: RouterModel<Id, Group> & RouterTargets<Id, Group>;
  readonly routeModel: RouteModel<Id, Group>;
  readonly layer: Layer.Layer<
    RouterModel<Id, Group> | RouteModel<Id, Group>,
    never,
    Exclude<RouterServicesForGroup<Group> | History | Registry, InstanceScope | Scope.Scope>
  >;
}

export const make = <const Id extends string, const Group extends AnyRouteGroup>(
  id: Id,
  routeGroup: Group,
  options: RouterOptions = {},
): AppRouter<Id, Group> => {
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

  // The per-key shape map is carried by the RouteModel interface itself
  // (the cast below) rather than the builder's `Shapes` argument: with
  // `Group` still generic TypeScript cannot verify the mapped-type
  // constraint and overload resolution falls apart.
  const routesService = Model.Service<RouteModel<Id, Group>>()(
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
  const routes = routesService as unknown as RouteModel<Id, Group>;

  const model = Object.assign(router, {
    buildLocation: (options: ToOptions<RouterController<Group>, RoutePath<RouterController<Group>>>) =>
      Effect.flatMap(getController(router), (api) => api.buildLocationEffect(options as never)),
    buildHref: (options: ToOptions<RouterController<Group>, RoutePath<RouterController<Group>>>) =>
      Effect.flatMap(getController(router), (api) => api.buildHrefEffect(options as never)),
  } as never) as RouterModel<Id, Group> & RouterTargets<Id, Group>;

  // `routes.layer`'s own `make` already leases `router` (`Model.get(router)`
  // above) — merging `model.layer` in satisfies that requirement, the same
  // composition an app previously wrote by hand at the call site.
  const layer = routes.layer.pipe(Layer.provideMerge(model.layer)) as AppRouter<Id, Group>["layer"];

  return { model, routeModel: routes, layer };
};

/** INTERNAL (used by RouterView): the pages model — one singleton owning
 * the router and every mapped page model, the view tree's root.
 *
 * Route data never flows in through a page model's `inputs` here — a
 * mapped model is a plain `Model.Singleton`, leased once with no relation
 * to any particular match. A model that needs its route's `Output` (see
 * {@link Route.Output}) on the first line of its own `make` should be keyed
 * by it and wired through `routeView` instead (`@unitflow/router/react`);
 * one that only needs to react to it over time can read the route's own
 * `outputs.provided` (`Store.Combined<Option<Route.Output<R>>>`) reactively. */
export const makePages = <
  M extends AnyRouter,
  const Pages extends PageMap<RouterGroupOf<M>>,
>(
  model: M,
  pageMap: Pages,
): PagesModel<RouterIdOf<M>, RouterGroupOf<M>, Pages> => {
  const pagesService = Model.Service<PagesModel<RouterIdOf<M>, RouterGroupOf<M>, Pages>>()(
    `${model.modelKey}/pages` as `${RouterIdOf<M>}/pages`,
  )({
    make: () =>
      Effect.gen(function* () {
        // The engine is a singleton (void key); the erased generic hides that.
        // eslint-disable-next-line revizo/no-type-assertion
        const routerPorts = yield* Model.get(model as unknown as RouterModel);
        const ui: Record<string, unknown> = { router: routerPorts };
        for (const [routeId, pageModel] of Object.entries(pageMap)) {
          if (pageModel === undefined) continue;
          ui[routeId] = yield* Model.get(pageModel as Model.AnyService);
        }
        return { inputs: {}, outputs: {}, ui } as never;
      }),
  });
  return Object.assign(pagesService, { router: model }) as unknown as PagesModel<
    RouterIdOf<M>,
    RouterGroupOf<M>,
    Pages
  >;
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
    const compiledById = new Map(compiled.map((current) => [current.route.id, current]));
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

        // Ancestors come from the explicitly declared `parentId` chain, not
        // from filtering the whole route list by path — a route with no
        // declared parent (including one at "/") is never an accidental
        // ancestor of anything else, only of itself.
        const chain: Array<CompiledRoute<Route.Any>> = [];
        let current: CompiledRoute<Route.Any> | undefined = leaf.compiledRoute;
        while (current !== undefined) {
          chain.push(current);
          const parentId: string | undefined = current.route.parentId;
          current = parentId === undefined ? undefined : compiledById.get(parentId);
        }
        chain.reverse(); // root-first, guards run parent-first

        // A pathless `Route.layout` ancestor has no slice of the pathname of
        // its own — no params/search to decode, just middlewares to run and
        // an id for the render tree to key on. A real ancestor's prefix
        // should always match (its path is, by construction, a literal
        // prefix of the leaf's own compiled path) — the null-filter is
        // defensive, not expected to trigger.
        const branch = chain
          .map((compiledRoute) =>
            compiledRoute.route.pathless === true
              ? { compiledRoute, match: [""] as unknown as RegExpExecArray }
              : { compiledRoute, match: compiledRoute.prefix.exec(pathname) },
          )
          .filter(
            (
              item,
            ): item is {
              readonly compiledRoute: CompiledRoute<Route.Any>;
              readonly match: RegExpExecArray;
            } => item.match !== null,
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
          // Guards run parent-first ACROSS route levels, before anything
          // commits: a failure here (RedirectError/NotFoundError) aborts the
          // whole navigation. WITHIN one route's own middlewares, concurrency
          // is opt-in via `middlewaresConcurrency` (sequential by default) —
          // results still merge in declaration order regardless of which
          // guard actually finished first.
          const pending = item.compiledRoute.route.middlewares.filter(
            (candidate) => !ranGuards.has(candidate),
          );
          for (const candidate of pending) ranGuards.add(candidate);
          const provides = yield* Effect.forEach(
            pending,
            (middleware) => Effect.flatMap(middleware, (handler) => handler(routeContext)),
            { concurrency: item.compiledRoute.route.middlewaresConcurrency ?? 1 },
          );
          for (const value of provides) {
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
      const hash = toOptions.hash === true ? currentState.location.hash : toOptions.hash ?? "";
      if (foundRoute === undefined) {
        // Not one of the registered route templates — a raw href
        // (`RawToOptions`): build the location straight from the string, no
        // param/search schema to encode against.
        return makeLocation(
          `${addBasepath(toOptions.to, options.basepath)}${hash === "" ? "" : `#${hash}`}`,
          parseSearch,
          toOptions.state,
        );
      }
      const targetRoute = foundRoute as RoutesOf<Group>;
      const routeParams = yield* encodeParams(targetRoute, toOptions.params);
      const pathname = yield* Effect.try({
        try: () => addBasepath(interpolatePath(targetRoute.path, routeParams), options.basepath),
        catch: (error) => error,
      });
      const rawSearch = yield* encodeSearch(targetRoute, toOptions.search);
      const searchString = stringifySearch(rawSearch);
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

    const navigateEvent = yield* Event.input<
      NavigateOptions<RouterController<Group>, RoutePath<RouterController<Group>>>
    >({ name: "router.navigate" }).pipe(Event.handler((payload) => navigate(payload as never)));
    const addBlockerEvent = yield* Event.input<Blocker>({ name: "router.addBlocker" }).pipe(
      Event.handler((blocker) => addBlocker(blocker)),
    );
    const removeBlockerEvent = yield* Event.input<Blocker>({ name: "router.removeBlocker" }).pipe(
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
      // The FULL dispatch step: counting, pubsub AND handler delivery. A
      // bare trackPublish+publishUnsafe pair feeds subscribers but never the
      // attached handler — history-driven navigation (back/forward, manual
      // URL) would silently do nothing.
      Event.dispatchUnsafe(registry, historyChannel, historyChanged, nextLocation);
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

/** A regex that never matches anything — for `Route.layout`'s implicit
 * parent, which has no real path and can never be a leaf/exact match. */
const NEVER_MATCH = /(?!)/;

const compileRoute = <R extends Route.Any>(current: R): CompiledRoute<R> => {
  if (current.pathless === true) {
    return { route: current, exact: NEVER_MATCH, prefix: NEVER_MATCH, paramNames: [], score: 0, length: 0 };
  }
  const path = normalizePath(current.path);
  if (path === "/") {
    return { route: current, exact: /^\/?$/, prefix: /^\//, paramNames: [], score: 0, length: 0 };
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
