# Queries

Use `Query` for model-owned async reads with visible loading, failure, refresh,
dependencies, polling, or pagination.

```ts
const results = yield* Query.make({
  stores: { query, category },
  handler: ({ query, category }) => searchProducts({ query, category }),
});

return {
  inputs: { reload: results.refresh },
  outputs: { results: results.state },
  ui: {
    searchState: Store.combine([query, category, results.state], (query, category, results) => ({
      query,
      category,
      results,
    })),
    setQuery: Event.setter(query),
    setCategory: Event.setter(category),
    reload: results.refresh,
  },
};
```

`state` starts as `AsyncResult.initial(true)` and loads eagerly. Refreshes and
dependency changes run the handler with fresh dependency values. Failed reloads
preserve the previous value through `AsyncResult.value(...)`.

Use `Query.refetchOn(...)` for event-driven refresh and `Query.repeat(...)`
for polling. Browser triggers (window focus, reconnect) need no dedicated
API: pipe `Stream.fromEventListener(document, "visibilitychange")` into
`Event.emit(query.refresh)` via `Registry.run` — the listener lives in the
owning model's scope.

For pagination, use `Query.makeInfinite`: one handler fetches every page
(`cursor` is `initialCursor` for the first, then the previous page's `next`),
and `next: Option.none()` marks the query exhausted. The state is the flat
concatenation of the loaded pages; the query gains `loadMore` and `hasMore`,
and `refresh` or any dependency change restarts from `initialCursor`.
`initialCursor` anchors the cursor type, so the handler needs no annotations;
token cursors start from `null as string | null` and lift the response token
with `Option.fromNullishOr`.

```ts
const products = yield* Query.makeInfinite({
  stores: { search },
  initialCursor: 0,
  handler: ({ search }, skip) =>
    Effect.map(fetchProducts({ search, skip, take: 20 }), (r) => ({
      data: r.items,
      next: skip + 20 < r.total ? Option.some(skip + 20) : Option.none(),
    })),
});
```

Use `Query.persist({ key, schema, timeToLive? })` to save every settled
success into a `KeyValueStore` (from `effect/unstable/persistence`) and seed
the state from the stored copy on construction while the initial load
revalidates. Best-effort: a stored entry that fails to decode or outlives
`timeToLive` is a miss, storage errors are logged and swallowed, failures are
never persisted, and a load that settles first wins over the stored copy.

Query has no cache layer of its own: the handler is a normal Effect, so use
`Effect.cachedWithTTL(request, ttl)` or a `Cache.make({ lookup, capacity,
timeToLive })` keyed by dependency values inside the handler.
