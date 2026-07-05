# Example: Query Search

The model owns search input, runs a `Query`, and depends on an injected
`CatalogApi` service.

```ts
const query = Store.make("dashboard");
const category = Store.make<Category>("all");

const results = yield* Query.make({
  stores: { query, category },
  handler: ({ query, category }) =>
    Effect.gen(function* () {
      const catalog = yield* CatalogApi;
      return yield* catalog.search({ query, category });
    }),
});

return {
  outputs: { results: results.state },
  ui: {
    searchState: Store.combine(
      [query, category, results.state],
      (query, category, results) => ({ query, category, results }),
    ),
    setQuery: Event.setter(query),
    setCategory: Event.setter(category),
    reload: results.refresh,
  },
};
```

Runnable app: `examples/ts/query-search`.
