import { Event, Model, Store } from "@unitflow/core";
import { Registry, trackPublish } from "@unitflow/core/registry";
import type * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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

export interface Register {}

type MaybeEffect<A, E, R> = A | Effect.Effect<A, E, R>;

type SuccessOf<T> = T extends Effect.Effect<infer A, any, any> ? A : T;
type ErrorOf<T> = T extends Effect.Effect<any, infer E, any> ? E : never;
type ServicesOf<T> = T extends Effect.Effect<any, any, infer R> ? R : never;
type FunctionReturn<F> = F extends (...args: ReadonlyArray<any>) => infer A ? A : never;
type FunctionSuccess<F> = SuccessOf<FunctionReturn<F>>;
type FunctionError<F> = ErrorOf<FunctionReturn<F>>;
type FunctionServices<F> = ServicesOf<FunctionReturn<F>>;
type BeforeContextOf<Before> = [FunctionSuccess<Before>] extends [never]
  ? EmptyRecord
  : [FunctionSuccess<Before>] extends [void]
    ? EmptyRecord
    : FunctionSuccess<Before>;
type LoaderDataOf<Loader> = [FunctionSuccess<Loader>] extends [never]
  ? undefined
  : FunctionSuccess<Loader>;

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

export interface RouteContext<Path extends string, Params, Search, Context> {
  readonly route: Route.Any;
  readonly location: ParsedLocation;
  readonly params: Params;
  readonly search: Search;
  readonly context: Context;
  readonly path: Path;
}

export type BeforeLoadFn<Path extends string, Params, Search, Context, A, E, R> = (
  context: RouteContext<Path, Params, Search, Context>,
) => MaybeEffect<A, E, R>;

export type LoaderFn<Path extends string, Params, Search, Context, A, E, R> = (
  context: RouteContext<Path, Params, Search, Context>,
) => MaybeEffect<A, E, R>;

export interface RouteOptions<
  Path extends string,
  ParamsSchema extends AnyParamsSchema,
  Search extends AnySearchDefinition,
  Before,
  Loader,
  View,
> {
  readonly path: Path;
  readonly params?: ParamsSchema;
  readonly search?: Search;
  readonly parseParams?: (
    params: PathParams<Path>,
  ) => MaybeEffect<ParamsOutputOf<Path, ParamsSchema> | false, any, any>;
  readonly stringifyParams?: (params: ParamsInputOf<Path, ParamsSchema>) => PathParams<Path>;
  readonly beforeLoad?: Before &
    BeforeLoadFn<Path, ParamsOutputOf<Path, ParamsSchema>, SearchOutputOf<Search>, SearchRecord, any, any, any>;
  readonly loader?: Loader &
    LoaderFn<
      Path,
      ParamsOutputOf<Path, ParamsSchema>,
      SearchOutputOf<Search>,
      BeforeContextOf<Before>,
      any,
      any,
      any
    >;
  readonly component?: View;
  readonly pendingComponent?: View;
  readonly errorComponent?: View;
  readonly notFoundComponent?: View;
  readonly staticData?: SearchRecord;
  readonly meta?: (
    context: RouteContext<Path, ParamsOutputOf<Path, ParamsSchema>, SearchOutputOf<Search>, any>,
  ) => ReadonlyArray<SearchRecord>;
  readonly links?: (
    context: RouteContext<Path, ParamsOutputOf<Path, ParamsSchema>, SearchOutputOf<Search>, any>,
  ) => ReadonlyArray<SearchRecord>;
  readonly preload?: false | "intent" | "viewport" | "render";
  readonly staleTime?: number;
  readonly preloadStaleTime?: number;
  readonly gcTime?: number;
  readonly caseSensitive?: boolean;
}

export interface Route<
  Id extends string,
  Path extends string,
  ParamsSchema extends AnyParamsSchema,
  Search extends AnySearchDefinition,
  Before,
  Loader,
  View,
> extends Pipeable {
  readonly [RouteTypeId]: typeof RouteTypeId;
  readonly id: Id;
  readonly path: Path;
  readonly options: RouteOptions<Path, ParamsSchema, Search, Before, Loader, View>;
  readonly "~types": {
    readonly id: Id;
    readonly path: Path;
    readonly params: ParamsOutputOf<Path, ParamsSchema>;
    readonly paramsInput: ParamsInputOf<Path, ParamsSchema>;
    readonly search: SearchOutputOf<Search>;
    readonly searchInput: SearchInputOf<Search>;
    readonly beforeContext: BeforeContextOf<Before>;
    readonly loaderData: LoaderDataOf<Loader>;
    readonly error:
      | ParamsErrorOf<ParamsSchema>
      | SearchErrorOf<Search>
      | FunctionError<Before>
      | FunctionError<Loader>
      | Redirect
      | NotFound;
    readonly services:
      | ParamsServicesOf<ParamsSchema>
      | SearchServicesOf<Search>
      | FunctionServices<Before>
      | FunctionServices<Loader>;
    readonly view: View;
  };
}

export namespace Route {
  export type Any = Route<string, any, AnyParamsSchema, AnySearchDefinition, any, any, any>;
  export type Id<R extends Any> = R["~types"]["id"];
  export type Path<R extends Any> = R["~types"]["path"];
  export type Params<R extends Any> = R["~types"]["params"];
  export type ParamsInput<R extends Any> = R["~types"]["paramsInput"];
  export type Search<R extends Any> = R["~types"]["search"];
  export type SearchInput<R extends Any> = R["~types"]["searchInput"];
  export type LoaderData<R extends Any> = R["~types"]["loaderData"];
  export type Error<R extends Any> = R["~types"]["error"];
  export type Services<R extends Any> = R["~types"]["services"];
  export type View<R extends Any> = R["~types"]["view"];
}

export const isRoute = (value: unknown): value is Route.Any =>
  typeof value === "object" && value !== null && RouteTypeId in value;

export const route = <
  const Id extends string,
  const Path extends string,
  ParamsSchema extends AnyParamsSchema = undefined,
  Search extends AnySearchDefinition = undefined,
  Before extends
    | BeforeLoadFn<Path, ParamsOutputOf<Path, ParamsSchema>, SearchOutputOf<Search>, any, any, any, any>
    | undefined =
      | BeforeLoadFn<Path, ParamsOutputOf<Path, ParamsSchema>, SearchOutputOf<Search>, any, any, any, any>
      | undefined,
  Loader extends
    | LoaderFn<
        Path,
        ParamsOutputOf<Path, ParamsSchema>,
        SearchOutputOf<Search>,
        BeforeContextOf<Before>,
        any,
        any,
        any
      >
    | undefined =
      | LoaderFn<
          Path,
          ParamsOutputOf<Path, ParamsSchema>,
          SearchOutputOf<Search>,
          BeforeContextOf<Before>,
          any,
          any,
          any
        >
      | undefined,
  View = unknown,
>(
  id: Id,
  options: RouteOptions<Path, ParamsSchema, Search, Before, Loader, View>,
): Route<Id, Path, ParamsSchema, Search, Before, Loader, View> => ({
  ...PipeableProto,
  [RouteTypeId]: RouteTypeId,
  id,
  path: normalizePath(options.path) as Path,
  options: { ...options, path: normalizePath(options.path) as Path },
  "~types": undefined as unknown as Route<Id, Path, ParamsSchema, Search, Before, Loader, View>["~types"],
});

type PrefixedRoute<R extends Route.Any, Prefix extends string> = R extends Route<
  infer Id,
  infer Path,
  infer ParamsSchema,
  infer Search,
  infer Before,
  infer Loader,
  infer View
>
  ? Route<Id, JoinPath<Prefix, Path>, ParamsSchema, Search, Before, Loader, View>
  : never;

const prefixRoute = <R extends Route.Any, const Prefix extends string>(
  current: R,
  prefix: Prefix,
): PrefixedRoute<R, Prefix> => {
  const path = joinPaths(prefix, current.path);
  return route(current.id, { ...current.options, path } as never) as PrefixedRoute<R, Prefix>;
};

export interface RouteGroup<R extends Route.Any> extends Pipeable {
  readonly [RouteGroupTypeId]: typeof RouteGroupTypeId;
  readonly routes: ReadonlyArray<R>;
  add<const R2 extends ReadonlyArray<Route.Any>>(...routes: R2): RouteGroup<R | R2[number]>;
  merge<const Groups extends ReadonlyArray<AnyRouteGroup>>(
    ...groups: Groups
  ): RouteGroup<R | RoutesOf<Groups[number]>>;
  prefix<const Prefix extends string>(prefix: Prefix): RouteGroup<PrefixedRoute<R, Prefix>>;
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
  readonly context: SearchRecord;
  readonly loaderData: Route.LoaderData<R>;
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

export interface RouteMask<TRouter extends AnyRouter = AnyRouter> {
  readonly from: RoutePath<TRouter>;
  readonly to: RoutePath<TRouter>;
  readonly unmaskOnReload?: boolean;
}

export interface RouterOptions<Context extends SearchRecord = EmptyRecord> {
  readonly history?: RouterHistory;
  readonly context?: Context;
  readonly basepath?: string;
  readonly defaultPreload?: false | "intent" | "viewport" | "render";
  readonly defaultStaleTime?: number;
  readonly defaultPreloadStaleTime?: number;
  readonly defaultGcTime?: number;
  readonly parseSearch?: (search: string) => RawSearch;
  readonly stringifySearch?: (search: SearchRecord) => string;
  readonly routeMasks?: ReadonlyArray<RouteMask<any>>;
  readonly notFoundMode?: "root" | "fuzzy";
  readonly defaultPendingComponent?: unknown;
  readonly defaultErrorComponent?: unknown;
  readonly defaultNotFoundComponent?: unknown;
}

export interface ActiveOptions {
  readonly exact?: boolean;
  readonly includeHash?: boolean;
  readonly includeSearch?: boolean;
}

export type Blocker = (options: {
  readonly from: ParsedLocation;
  readonly to: ParsedLocation;
}) => boolean | Promise<boolean>;

export interface RouterBlocker {
  readonly unblock: Effect.Effect<void, never, Registry>;
}

export interface RouterController<
  Group extends AnyRouteGroup = AnyRouteGroup,
  Context extends SearchRecord = SearchRecord,
> {
  readonly group: Group;
  readonly routes: ReadonlyArray<RoutesOf<Group>>;
  readonly options: RouterOptions<Context>;
  readonly history: RouterHistory;
  readonly buildLocation: <const To extends RoutePath<RouterController<Group, Context>>>(
    options: ToOptions<RouterController<Group, Context>, To>,
  ) => ParsedLocation;
  readonly buildHref: <const To extends RoutePath<RouterController<Group, Context>>>(
    options: ToOptions<RouterController<Group, Context>, To>,
  ) => string;
  readonly buildLocationEffect: <const To extends RoutePath<RouterController<Group, Context>>>(
    options: ToOptions<RouterController<Group, Context>, To>,
  ) => Effect.Effect<ParsedLocation, unknown, RouterServicesForGroup<Group> | Registry>;
  readonly buildHrefEffect: <const To extends RoutePath<RouterController<Group, Context>>>(
    options: ToOptions<RouterController<Group, Context>, To>,
  ) => Effect.Effect<string, unknown, RouterServicesForGroup<Group> | Registry>;
  readonly navigate: <const To extends RoutePath<RouterController<Group, Context>>>(
    options: NavigateOptions<RouterController<Group, Context>, To>,
  ) => Effect.Effect<void, never, RouterServicesForGroup<Group> | Registry>;
  readonly preload: <const To extends RoutePath<RouterController<Group, Context>>>(
    options: ToOptions<RouterController<Group, Context>, To>,
  ) => Effect.Effect<void, never, RouterServicesForGroup<Group> | Registry>;
  readonly matchRoute: <const To extends RoutePath<RouterController<Group, Context>>>(
    options: ToOptions<RouterController<Group, Context>, To> & ActiveOptions,
  ) => boolean;
  readonly invalidate: () => Effect.Effect<void, never, RouterServicesForGroup<Group> | Registry>;
  readonly updateContext: (context: Partial<Context>) => Effect.Effect<void>;
  readonly block: (blocker: Blocker) => Effect.Effect<RouterBlocker, never, Registry>;
  readonly unblock: (blocker: Blocker) => Effect.Effect<void>;
  readonly dispose: () => Effect.Effect<void>;
}

export type AnyRouterController = RouterController<any, any>;

export type NavigatePayload<M extends AnyRouter> = NavigateOptions<M, RoutePath<M>>;
export type PreloadPayload<M extends AnyRouter> = ToOptions<M, RoutePath<M>>;

export interface RouterShape<
  Group extends AnyRouteGroup,
  Context extends SearchRecord,
> extends Model.Shape {
  readonly inputs: {
    readonly navigate: Event.Event<NavigateOptions<RouterController<Group, Context>, RoutePath<RouterController<Group, Context>>>>;
    readonly preload: Event.Event<ToOptions<RouterController<Group, Context>, RoutePath<RouterController<Group, Context>>>>;
    readonly invalidate: Event.Event<void>;
    readonly updateContext: Event.Event<Partial<Context>>;
    readonly addBlocker: Event.Event<Blocker>;
    readonly removeBlocker: Event.Event<Blocker>;
  };
  readonly outputs: {
    readonly state: Store.Store<RouterState<RoutesOf<Group>>>;
    readonly location: Store.Combined<ParsedLocation>;
    readonly matches: Store.Combined<ReadonlyArray<RouteMatch<RoutesOf<Group>>>>;
    readonly api: Store.Store<RouterController<Group, Context>>;
  };
  readonly ui: {
    readonly state: Store.Store<RouterState<RoutesOf<Group>>>;
    readonly location: Store.Combined<ParsedLocation>;
    readonly matches: Store.Combined<ReadonlyArray<RouteMatch<RoutesOf<Group>>>>;
    readonly navigate: Event.Event<NavigateOptions<RouterController<Group, Context>, RoutePath<RouterController<Group, Context>>>>;
    readonly preload: Event.Event<ToOptions<RouterController<Group, Context>, RoutePath<RouterController<Group, Context>>>>;
    readonly invalidate: Event.Event<void>;
    readonly api: Store.Store<RouterController<Group, Context>>;
  };
}

type RouterServicesForGroup<Group extends AnyRouteGroup> = RoutesOf<Group> extends infer R
  ? R extends Route.Any
    ? Route.Services<R>
    : never
  : never;

export interface RouterModel<
  Id extends string = string,
  Group extends AnyRouteGroup = AnyRouteGroup,
  Context extends SearchRecord = SearchRecord,
> extends Model.ServiceClass<
    RouterModel<Id, Group, Context>,
    Id,
    void,
    RouterShape<Group, Context>,
    never,
    RouterServicesForGroup<Group> | Registry
  > {
  readonly group: Group;
  readonly routes: ReadonlyArray<RoutesOf<Group>>;
  readonly options: RouterOptions<Context>;
  readonly routerType: {
    readonly id: Id;
    readonly group: Group;
    readonly context: Context;
  };
}

export type AnyRouter = RouterModel<string, AnyRouteGroup, SearchRecord>;
export type RegisteredRouter = Register extends { readonly router: infer R extends AnyRouter }
  ? R
  : AnyRouter;
export type RouterGroupOf<TRouter> =
  TRouter extends RouterModel<any, infer Group, any>
    ? Group
    : TRouter extends RouterController<infer Group, any>
      ? Group
      : never;
export type RouterContextOf<TRouter> =
  TRouter extends RouterModel<any, any, infer RouterContext>
    ? RouterContext
    : TRouter extends RouterController<any, infer RouterContext>
      ? RouterContext
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
export interface RouterPortsLike<R extends Route.Any = Route.Any> {
  readonly outputs: {
    readonly matches: Store.Source<ReadonlyArray<RouteMatch<R>>>;
  };
}
type RoutesOfPorts<Ports> = Ports extends RouterPortsLike<infer R> ? R : never;
type MatchByOpenPath<Routes, Path> = Routes extends Route.Any
  ? Route.Path<Routes> extends Path
    ? RouteMatch<Routes>
    : never
  : never;
export type RouterControllerOf<M extends AnyRouter> = RouterController<
  RouterGroupOf<M>,
  RouterContextOf<M>
>;

type PathParamsFor<TRouter, To> = Route.ParamsInput<RouteByPath<TRouter, To>>;
type SearchInputFor<TRouter, To> = Route.SearchInput<RouteByPath<TRouter, To>>;

type PathParamOptions<Params> = keyof Params extends never
  ? { readonly params?: Params | true }
  : { readonly params: Params | true };

type SearchParamOptions<Search> = keyof Search extends never
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

export class Redirect extends Error {
  readonly options: any;
  constructor(options: any) {
    super("Unitflow router redirect");
    this.name = "Redirect";
    this.options = options;
  }
}

export class NotFound extends Error {
  readonly routeId: string | undefined;
  constructor(routeId?: string) {
    super("Unitflow router not found");
    this.name = "NotFound";
    this.routeId = routeId;
  }
}

export const redirect = <
  TRouter extends AnyRouter | AnyRouterController = RegisteredRouter,
  const To extends RoutePath<TRouter> = RoutePath<TRouter>,
>(
  options: NavigateOptions<TRouter, To>,
): Redirect => new Redirect(options);

export const notFound = (routeId?: string): NotFound => new NotFound(routeId);
export const isRedirect = (value: unknown): value is Redirect => value instanceof Redirect;
export const isNotFound = (value: unknown): value is NotFound => value instanceof NotFound;

interface CompiledRoute<R extends Route.Any> {
  readonly route: R;
  readonly exact: RegExp;
  readonly prefix: RegExp;
  readonly paramNames: ReadonlyArray<{ readonly name: string; readonly optional: boolean }>;
  readonly score: number;
  readonly length: number;
}

interface LoaderCacheEntry {
  readonly value: unknown;
  readonly updatedAt: number;
  readonly timer?: ReturnType<typeof setTimeout>;
}

export const make = <
  const Id extends string,
  const Group extends AnyRouteGroup,
  Context extends SearchRecord = EmptyRecord,
>(
  id: Id,
  routeGroup: Group,
  options: RouterOptions<Context> = {},
): RouterModel<Id, Group, Context> => {
  const service = Model.Service<RouterModel<Id, Group, Context>>()(id)({
    lifetime: "keepAlive",
    make: () => makeShape(routeGroup, options),
  });

  return Object.assign(service, {
    group: routeGroup,
    routes: routeGroup.routes as unknown as ReadonlyArray<RoutesOf<Group>>,
    options,
    routerType: undefined as unknown as RouterModel<Id, Group, Context>["routerType"],
  }) as RouterModel<Id, Group, Context>;
};

const makeShape = <
  Group extends AnyRouteGroup,
  Context extends SearchRecord,
>(
  routeGroup: Group,
  options: RouterOptions<Context>,
): Effect.Effect<RouterShape<Group, Context>, never, RouterServicesForGroup<Group> | Registry> =>
  (Effect.gen(function* () {
    const parseSearch = options.parseSearch ?? defaultParseSearch;
    const stringifySearch = options.stringifySearch ?? defaultStringifySearch;
    const history = options.history ?? createBrowserHistory({ parseSearch });
    const compiled = routeGroup.routes.map(compileRoute).sort((a, b) => b.score - a.score);
    const blockers = new Set<Blocker>();
    const cache = new Map<string, LoaderCacheEntry>();
    let context = { ...(options.context ?? {}) } as Context;
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

    const loaderKey = (current: Route.Any, params: unknown, routeSearch: unknown): string =>
      `${current.id}:${stableStringify(params)}:${stableStringify(routeSearch)}`;

    const setCached = (key: string, value: unknown, current: Route.Any): void => {
      const previous = cache.get(key);
      if (previous?.timer !== undefined) clearTimeout(previous.timer);
      const gcTime = current.options.gcTime ?? options.defaultGcTime ?? 1_800_000;
      const entry: LoaderCacheEntry =
        gcTime === Infinity
          ? { value, updatedAt: Date.now() }
          : {
              value,
              updatedAt: Date.now(),
              timer: setTimeout(() => {
                cache.delete(key);
              }, gcTime),
            };
      cache.set(key, entry);
    };

    const loadData = (
      current: Route.Any,
      routeContext: RouteContext<string, any, any, SearchRecord>,
      mode: "navigate" | "preload",
    ): Effect.Effect<unknown, unknown, Route.Services<Route.Any>> => {
      const loader = current.options.loader;
      if (loader === undefined) return Effect.succeed(undefined);
      const key = loaderKey(current, routeContext.params, routeContext.search);
      const now = Date.now();
      const cached = cache.get(key);
      const staleTime =
        mode === "preload"
          ? current.options.preloadStaleTime ?? options.defaultPreloadStaleTime ?? 30_000
          : current.options.staleTime ?? options.defaultStaleTime ?? 0;
      if (cached !== undefined && (staleTime === Infinity || now - cached.updatedAt < staleTime)) {
        return Effect.succeed(cached.value);
      }
      return Effect.exit(runMaybe(() => loader(routeContext))).pipe(
        Effect.flatMap((exit) => {
          if (Exit.isSuccess(exit)) {
            return Effect.sync(() => {
              setCached(key, exit.value, current);
              return exit.value;
            });
          }
          return Effect.flatMap(
            Effect.sync(() => {
              cache.delete(key);
            }),
            () => Effect.fail(exitToError(exit)),
          );
        }),
      );
    };

    const resolveMatches = (
      location: ParsedLocation,
      mode: "navigate" | "preload",
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
        if (leaf === undefined) return yield* Effect.fail(new NotFound());

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

        let accumulatedContext: SearchRecord = context;
        const matches: Array<RouteMatch<Route.Any>> = [];
        for (const item of branch) {
          const rawParams = extractParams(item.compiledRoute, item.match);
          const params = yield* parseParams(item.compiledRoute.route, rawParams as never);
          if (params === false) continue;
          const routeSearch = yield* decodeSearch(item.compiledRoute.route, location.search);
          const baseContext: RouteContext<string, any, any, SearchRecord> = {
            route: item.compiledRoute.route,
            location,
            params,
            search: routeSearch,
            context: accumulatedContext,
            path: item.compiledRoute.route.path,
          };
          const before = item.compiledRoute.route.options.beforeLoad;
          if (before !== undefined) {
            const next = yield* runMaybe(() => before(baseContext));
            if (next !== undefined && next !== null && typeof next === "object") {
              accumulatedContext = { ...accumulatedContext, ...(next as SearchRecord) };
            }
          }
          const routeContext = { ...baseContext, context: accumulatedContext };
          const loaderData = yield* loadData(item.compiledRoute.route, routeContext, mode);
          const meta = item.compiledRoute.route.options.meta?.(routeContext) ?? [];
          const links = item.compiledRoute.route.options.links?.(routeContext) ?? [];
          matches.push({
            id: item.compiledRoute.route.id,
            route: item.compiledRoute.route,
            pathname: item.match[0] === "" ? "/" : item.match[0],
            params,
            search: routeSearch,
            context: accumulatedContext,
            loaderData,
            staticData: item.compiledRoute.route.options.staticData ?? {},
            meta,
            links,
            status: "success",
          });
        }
        if (!matches.some((match) => match.route === leaf.compiledRoute.route)) {
          return yield* Effect.fail(new NotFound());
        }
        return matches as unknown as ReadonlyArray<RouteMatch<RoutesOf<Group>>>;
      });

    const load = (
      location: ParsedLocation,
      displayLocation: ParsedLocation,
      mode: "navigate" | "preload",
    ): Effect.Effect<ReadonlyArray<RouteMatch<RoutesOf<Group>>>, unknown, RouterServicesForGroup<Group> | Registry> =>
      Effect.gen(function* () {
        if (mode === "navigate") {
          yield* setState({
            ...currentState,
            status: "pending",
            pendingLocation: displayLocation,
          });
        }
        return yield* resolveMatches(location, mode);
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

    const buildLocationEffect = <const To extends RoutePath<RouterController<Group, Context>>>(
      toOptions: ToOptions<RouterController<Group, Context>, To>,
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

    const buildLocation = <const To extends RoutePath<RouterController<Group, Context>>>(
      toOptions: ToOptions<RouterController<Group, Context>, To>,
    ): ParsedLocation => {
      const exit = Effect.runSyncExit(
        buildLocationEffect(toOptions) as Effect.Effect<ParsedLocation, unknown>,
      );
      if (Exit.isSuccess(exit)) return exit.value;
      throw exitToError(exit);
    };

    const buildHref = <const To extends RoutePath<RouterController<Group, Context>>>(
      toOptions: ToOptions<RouterController<Group, Context>, To>,
    ): string => buildLocation(toOptions).href;

    const buildHrefEffect = <const To extends RoutePath<RouterController<Group, Context>>>(
      toOptions: ToOptions<RouterController<Group, Context>, To>,
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
        status: isNotFound(error) ? "not-found" : "error",
        location: location ?? currentState.location,
        resolvedLocation: resolvedLocation ?? currentState.resolvedLocation,
        matches: location === undefined ? currentState.matches : [],
        error,
      });

    const commitLocation = (
      location: ParsedLocation,
    ): Effect.Effect<void, never, RouterServicesForGroup<Group> | Registry> =>
      Effect.exit(load(location, location, "navigate")).pipe(
        Effect.flatMap((exit) => {
          if (Exit.isSuccess(exit)) {
            return setState({
              status: "success",
              location,
              resolvedLocation: location,
              matches: exit.value,
            });
          }
          return handleError(exitToError(exit), location, location);
        }),
      );

    const navigate = <const To extends RoutePath<RouterController<Group, Context>>>(
      navigateOptions: NavigateOptions<RouterController<Group, Context>, To>,
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
        const exit = yield* Effect.exit(load(resolvedLocation, displayLocation, "navigate"));
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
        if (isRedirect(error)) {
          yield* navigate({ ...error.options, replace: true } as never);
          return;
        }
        yield* handleError(error);
      });

    const preload = <const To extends RoutePath<RouterController<Group, Context>>>(
      toOptions: ToOptions<RouterController<Group, Context>, To>,
    ): Effect.Effect<void, never, RouterServicesForGroup<Group> | Registry> => {
      return Effect.exit(buildLocationEffect(toOptions)).pipe(
        Effect.flatMap((exit) => {
          if (Exit.isFailure(exit)) return handleError(exitToError(exit));
          const location = exit.value;
          return Effect.exit(load(location, location, "preload")).pipe(
            Effect.flatMap((loadExit) => {
              if (
                Exit.isSuccess(loadExit) ||
                isNotFound(exitToError(loadExit)) ||
                isRedirect(exitToError(loadExit))
              ) {
                return Effect.void;
              }
              return handleError(exitToError(loadExit));
            }),
          );
        }),
      );
    };

    const matchRoute = <const To extends RoutePath<RouterController<Group, Context>>>(
      matchOptions: ToOptions<RouterController<Group, Context>, To> & ActiveOptions,
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

    const invalidate = (): Effect.Effect<void, never, RouterServicesForGroup<Group> | Registry> =>
      Effect.gen(function* () {
        for (const entry of cache.values()) {
          if (entry.timer !== undefined) clearTimeout(entry.timer);
        }
        cache.clear();
        const exit = yield* Effect.exit(load(currentState.resolvedLocation, currentState.location, "navigate"));
        if (Exit.isSuccess(exit)) {
          yield* setState({
            status: "success",
            location: currentState.location,
            resolvedLocation: currentState.resolvedLocation,
            matches: exit.value,
          });
        } else {
          yield* handleError(exitToError(exit));
        }
      });

    const dispose = (): Effect.Effect<void> =>
      Effect.sync(() => {
        disposed = true;
        blockers.clear();
        for (const entry of cache.values()) {
          if (entry.timer !== undefined) clearTimeout(entry.timer);
        }
        cache.clear();
      });

    const controller: RouterController<Group, Context> = {
      group: routeGroup,
      routes: routeGroup.routes as unknown as ReadonlyArray<RoutesOf<Group>>,
      options,
      history,
      buildLocation,
      buildHref,
      buildLocationEffect,
      buildHrefEffect,
      navigate,
      preload,
      matchRoute,
      invalidate,
      updateContext(nextContext) {
        return Effect.sync(() => {
          context = { ...context, ...nextContext };
        });
      },
      block(blocker) {
        return Effect.sync(() => {
          blockers.add(blocker);
          return {
            unblock: Effect.sync(() => {
              blockers.delete(blocker);
            }),
          };
        });
      },
      unblock(blocker) {
        return Effect.sync(() => {
          blockers.delete(blocker);
        });
      },
      dispose,
    };

    const navigateEvent = yield* Event.make<
      NavigateOptions<RouterController<Group, Context>, RoutePath<RouterController<Group, Context>>>
    >({ name: "router.navigate" }).pipe(Event.handler((payload) => controller.navigate(payload as never)));
    const preloadEvent = yield* Event.make<
      ToOptions<RouterController<Group, Context>, RoutePath<RouterController<Group, Context>>>
    >({ name: "router.preload" }).pipe(Event.handler((payload) => controller.preload(payload as never)));
    const invalidateEvent = yield* Event.make({ name: "router.invalidate" }).pipe(
      Event.handler(() => controller.invalidate()),
    );
    const updateContextEvent = yield* Event.make<Partial<Context>>({
      name: "router.updateContext",
    }).pipe(Event.handler((payload) => controller.updateContext(payload)));
    const addBlockerEvent = yield* Event.make<Blocker>({ name: "router.addBlocker" }).pipe(
      Event.handler((blocker) => Effect.asVoid(controller.block(blocker))),
    );
    const removeBlockerEvent = yield* Event.make<Blocker>({ name: "router.removeBlocker" }).pipe(
      Event.handler((blocker) => controller.unblock(blocker)),
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
        preload: preloadEvent,
        invalidate: invalidateEvent,
        updateContext: updateContextEvent,
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
        preload: preloadEvent,
        invalidate: invalidateEvent,
        api,
      },
    };
  }) as Effect.Effect<RouterShape<Group, Context>, never, RouterServicesForGroup<Group> | Registry>);

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

export const controller = getController;

export const buildLocation = <M extends AnyRouter, const To extends RoutePath<M>>(
  router: M,
  options: ToOptions<M, To>,
): Effect.Effect<
  ParsedLocation,
  unknown,
  Context.Service.Identifier<M> | Registry | RouterServicesForGroup<RouterGroupOf<M>>
> => Effect.flatMap(getController(router), (api) => api.buildLocationEffect(options as never));

export const buildHref = <M extends AnyRouter, const To extends RoutePath<M>>(
  router: M,
  options: ToOptions<M, To>,
): Effect.Effect<
  string,
  unknown,
  Context.Service.Identifier<M> | Registry | RouterServicesForGroup<RouterGroupOf<M>>
> => Effect.flatMap(getController(router), (api) => api.buildHrefEffect(options as never));

export const navigate = <M extends AnyRouter, const To extends RoutePath<M>>(
  router: M,
  options: NavigateOptions<M, To>,
): Effect.Effect<
  void,
  never,
  Context.Service.Identifier<M> | Registry | RouterServicesForGroup<RouterGroupOf<M>>
> => Effect.flatMap(getController(router), (api) => api.navigate(options as never));

export const preload = <M extends AnyRouter, const To extends RoutePath<M>>(
  router: M,
  options: ToOptions<M, To>,
): Effect.Effect<
  void,
  never,
  Context.Service.Identifier<M> | Registry | RouterServicesForGroup<RouterGroupOf<M>>
> => Effect.flatMap(getController(router), (api) => api.preload(options as never));

export const matchRoute = <M extends AnyRouter, const To extends RoutePath<M>>(
  router: M,
  options: ToOptions<M, To> & ActiveOptions,
): Effect.Effect<boolean, never, Context.Service.Identifier<M> | Registry> =>
  Effect.map(getController(router), (api) => api.matchRoute(options as never));

export const invalidate = <M extends AnyRouter>(
  router: M,
): Effect.Effect<
  void,
  never,
  Context.Service.Identifier<M> | Registry | RouterServicesForGroup<RouterGroupOf<M>>
> => Effect.flatMap(getController(router), (api) => api.invalidate());

export const updateContext = <M extends AnyRouter>(
  router: M,
  context: Partial<RouterContextOf<M>>,
): Effect.Effect<void, never, Context.Service.Identifier<M> | Registry> =>
  Effect.flatMap(getController(router), (api) => api.updateContext(context));

export const block = <M extends AnyRouter>(
  router: M,
  blocker: Blocker,
): Effect.Effect<RouterBlocker, never, Context.Service.Identifier<M> | Registry> =>
  Effect.flatMap(getController(router), (api) => api.block(blocker));

const isRouterPorts = (value: unknown): value is RouterPortsLike =>
  typeof value === "object" && value !== null && "outputs" in value;

const currentFromPorts = <Ports extends RouterPortsLike>(
  router: Ports,
): Store.Combined<RouteMatch<RoutesOfPorts<Ports>> | undefined> =>
  Store.combine(
    [router.outputs.matches],
    (matches) => matches.at(-1) as RouteMatch<RoutesOfPorts<Ports>> | undefined,
    { name: "router.current" },
  );

const openedFromPorts = <
  Ports extends RouterPortsLike,
  const Path extends Route.Path<RoutesOfPorts<Ports>>,
>(
  router: Ports,
  path: Path,
): Store.Combined<MatchByOpenPath<RoutesOfPorts<Ports>, Path> | undefined> =>
  Store.combine(
    [router.outputs.matches],
    (matches) =>
      matches.find((match) => match.route.path === path) as
        | MatchByOpenPath<RoutesOfPorts<Ports>, Path>
        | undefined,
    { name: `router.opened:${path}` },
  );

export function current<M extends AnyRouter>(
  router: M,
): Effect.Effect<
  Store.Combined<MatchUnion<M> | undefined>,
  never,
  Context.Service.Identifier<M> | Registry
>;
export function current<Ports extends RouterPortsLike>(
  router: Ports,
): Store.Combined<RouteMatch<RoutesOfPorts<Ports>> | undefined>;
export function current(router: any): any {
  if (isRouterPorts(router)) return currentFromPorts(router);
  return Effect.map(Model.get(router), (ports) => currentFromPorts(ports as unknown as RouterPortsLike));
}

export function opened<M extends AnyRouter, const Path extends RoutePath<M>>(
  router: M,
  path: Path,
): Effect.Effect<
  Store.Combined<MatchByPath<M, Path> | undefined>,
  never,
  Context.Service.Identifier<M> | Registry
>;
export function opened<
  Ports extends RouterPortsLike,
  const Path extends Route.Path<RoutesOfPorts<Ports>>,
>(
  router: Ports,
  path: Path,
): Store.Combined<MatchByOpenPath<RoutesOfPorts<Ports>, Path> | undefined>;
export function opened(router: any, path: string): any {
  if (isRouterPorts(router)) return openedFromPorts(router, path);
  return Effect.map(Model.get(router), (ports) =>
    openedFromPorts(ports as unknown as RouterPortsLike, path),
  );
}

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
