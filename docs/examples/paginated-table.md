# Example: Paginated Table

A paginated table of repositories with nested pagination: hovering the
contributors cell opens a popover whose list is its own infinite query with
scroll-to-load-more.

Nested pagination is composition, not an API feature. The table is a
singleton model with a token-cursor `Query.makeInfinite`; each row's popover
content is a keyed child model (`{ repoId }`) with an offset-cursor infinite
query, owned by the table through `Model.list` and materialized lazily by an
`openContributors` event (`push` is idempotent).

```ts
const rows = yield* Query.makeInfinite({
  stores: { language },
  initialCursor: null as string | null,
  handler: ({ language }, cursor) =>
    Effect.gen(function* () {
      const api = yield* DirectoryApi;
      const page = yield* api.repos({ language, cursor });
      return { data: page.items, next: Option.fromNullishOr(page.next) };
    }),
});
```

Which instances exist is the model's decision (the `openContributors`
event); which popover is visible is presentation state in React. The View
looks the unit up in `contributorPanels` the model owns and hands it down.
Infinite scroll needs no debouncing — `loadMore` is a guarded no-op while
loading or exhausted.

Runnable app: `examples/ts/paginated-table`.
