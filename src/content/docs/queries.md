---
title: Queries
description: Observable async reads with eager loading, refresh, dependencies, polling, and pagination.
---

Use `Query` for async reads that belong to a model and need visible state.
The handler is a normal Effect, so it can use layers, typed errors, retry,
timeout, schedules, schemas, and any other Effect service.

A query owns:

```ts
{
  state: Store.Store<AsyncResult.AsyncResult<A, E>>;
  refresh: Event.Event<void>;
  stores: Deps;
}
```

`state` starts as `AsyncResult.initial(true)`, so a query begins in a loading
state and loads eagerly during construction. A successful load writes
`AsyncResult.success(value)`. A failed reload writes failure state while keeping
the previous value available through `AsyncResult.value(...)`.

## Simple Read

```ts
import * as Effect from "effect/Effect";
import { Model, Query } from "@unitflow/core";

interface Project {
  readonly id: string;
  readonly name: string;
}

const fetchProjects = Effect.succeed<ReadonlyArray<Project>>([
  { id: "p1", name: "Lobby refresh" },
]);

export class ProjectsModel extends Model.Service<ProjectsModel>()(
  "docs/projects",
)({
  make: Effect.gen(function* () {
    const projects = yield* Query.make(fetchProjects);

    return {
      inputs: {
        refresh: projects.refresh,
      },
      outputs: {
        projects: projects.state,
      },
      ui: {
        projects: projects.state,
        refresh: projects.refresh,
      },
    };
  }),
}) {}
```

Expose `query.state` when a parent, test, or View should observe loading,
failure, and value. Expose `query.refresh` when something may reload it.

## Dependency Stores

Pass dependency stores through `stores`. The handler receives fresh dependency
values on the initial load, on refresh, and after any dependency changes.

```ts
import * as Effect from "effect/Effect";
import { Query, Store } from "@unitflow/core";

interface Product {
  readonly id: string;
  readonly title: string;
}

type Category = "all" | "hardware" | "software";

const searchProducts = (input: {
  readonly query: string;
  readonly category: Category;
}) => Effect.succeed<ReadonlyArray<Product>>([]);

const query = Store.make("dashboard");
const category = Store.make<Category>("all");

const results = yield* Query.make({
  stores: { query, category },
  handler: ({ query, category }) => searchProducts({ query, category }),
});
```

Dependency stores describe when the read should reload. The model changes
ordinary stores; the query reruns with fresh dependency values.

## Reading AsyncResult

Views receive `AsyncResult` as data.

```tsx
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

return (
  <section>
    {AsyncResult.builder(result)
      .onWaiting(() => <Spinner />)
      .onSuccess((products) => <ProductList products={products} />)
      .onFailure(() => <ErrorBanner />)
      .orNull()}
  </section>
);
```

Put `onWaiting` first when loading should win over the success or failure
branch.

## Refetch on Events

Use `Query.refetchOn(...)` when outside events should emit `refresh`.

```ts
const saved = Event.make<Project>();
const removed = Event.make<string>();

const projects = yield* Query.make(fetchProjects).pipe(
  Query.refetchOn(saved, removed),
);
```

Browser triggers — refetch on window focus or reconnect — are the same
pattern: any DOM event is a stream, and `Registry.run` scopes the listener to
the owning model, so it is removed when the model is disposed.

```ts
const projects = yield* Query.make(fetchProjects);

yield* Registry.run(
  Stream.fromEventListener(document, "visibilitychange").pipe(
    Stream.filter(() => document.visibilityState === "visible"),
    Stream.mapEffect(() => Event.emit(projects.refresh)),
  ),
);

yield* Registry.run(
  Stream.fromEventListener(window, "online").pipe(
    Stream.mapEffect(() => Event.emit(projects.refresh)),
  ),
);
```

Refreshes keep the previous value while loading — pair the handler with
`Effect.cachedWithTTL` when a focus refetch should not hit the network every
time.

## Polling

Use `Query.repeat(schedule)` for polling.

```ts
import * as Schedule from "effect/Schedule";

const status = yield* Query.make(fetchStatus).pipe(
  Query.repeat(Schedule.spaced("30 seconds")),
);
```

For retry behavior, put `Effect.retry(...)` inside the query handler. Repeat is
polling, not retry.

## Pagination

Use `Query.makeInfinite` when the read is a growing list. One handler fetches
every page: `cursor` is `initialCursor` for the first page, afterwards the
previous page's `next`. `next` is an `Option`: `Option.some(cursor)` when
another page exists, `Option.none()` when exhausted.

```ts
import * as Option from "effect/Option";

const products = yield* Query.makeInfinite({
  stores: { search },
  initialCursor: 0,
  handler: ({ search }, skip) =>
    Effect.map(fetchProducts({ search, skip, take: 20 }), (r) => ({
      data: r.items,
      next: skip + 20 < r.total ? Option.some(skip + 20) : Option.none(),
    })),
});

return {
  inputs: { reload: products.refresh, loadMore: products.loadMore },
  outputs: { products: products.state },
  ui: {
    products: products.state,
    hasMore: products.hasMore,
    reload: products.refresh,
    loadMore: products.loadMore,
  },
};
```

The state is the flat concatenation of every loaded page — the cursor never
appears in it. The cursor is any value the next request needs: an offset, a
page number, or a backend token. `initialCursor` doubles as the inference
anchor for the cursor type, so the handler needs no annotations; for token
cursors where the first request has no token, start from `null` and lift the
nullable response token with `Option.fromNullishOr`:

```ts
const feed = yield* Query.makeInfinite({
  initialCursor: null as string | null,
  handler: (_deps, cursor) =>
    Effect.map(fetchFeed({ cursor }), (r) => ({
      data: r.posts,
      next: Option.fromNullishOr(r.nextToken),
    })),
});
```

`hasMore` derives from the last page's `next`.

`loadMore` is a no-op while the query is waiting, before a value exists, or
after `hasMore` becomes false. A failed `loadMore` keeps the loaded value and
stays retryable. `refresh` and any dependency change restart from the first
page.

## Persistence

Use `Query.persist(...)` to keep the last success in a `KeyValueStore` and
show it instantly on the next construction while the initial load revalidates
in the background.

```ts
import * as Schema from "effect/Schema";

const products = yield* Query.make({
  stores: { search },
  handler: ({ search }) => fetchProducts({ search }),
}).pipe(
  Query.persist({
    key: "products",
    schema: Schema.Array(ProductSchema),
    timeToLive: "1 hour",
  }),
);
```

The requirements gain `KeyValueStore`. For `localStorage`, provide
`KeyValueStore.layerStorage(() => localStorage)` from
`effect/unstable/persistence/KeyValueStore`. In tests, use
`KeyValueStore.layerMemory`.

Persistence is best-effort and never affects the query itself:

- Every settled success is encoded through the schema and saved with a
  timestamp. Failures are never persisted.
- On construction, a stored entry seeds the state — marked waiting — while the
  initial load is in flight. A load that settles first wins.
- An entry that fails to decode, or is older than `timeToLive`, is a cache
  miss: the schema is the migration story, old shapes fall back to the
  network.
- Storage and codec errors are logged as warnings and swallowed.

The key is static: when the persisted value depends on dependency stores or a
model key, weave those into `key` yourself (for example
`persist:products:${categoryId}`). For a paginated query the concatenated
list is restored, but the cursor is not — the background reload replaces it
with a fresh first page.

## Caching

Query adds no cache layer of its own: the handler is a normal Effect, so
Effect's caching composes inside it.

```ts
import * as Cache from "effect/Cache";

// One request, cached for its TTL.
const cachedFetch = yield* Effect.cachedWithTTL(fetchStatus, "30 seconds");
const status = yield* Query.make(cachedFetch);

// Keyed by dependency values: flipping filters back and forth within the
// TTL does not refetch. Keys are compared structurally, so the deps record
// is a valid key as-is.
const cache = yield* Cache.make({
  lookup: (deps: { query: string; category: Category }) => searchProducts(deps),
  capacity: 64,
  timeToLive: "1 minute",
});
const results = yield* Query.make({
  stores: { query, category },
  handler: (deps) => Cache.get(cache, deps),
});
```

For caching across model instances, put the `Cache` in a service layer; for
keeping a model instance itself warm, use `lifetime: { idleTimeToLive }`.
