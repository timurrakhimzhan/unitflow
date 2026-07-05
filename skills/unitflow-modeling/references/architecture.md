# Unitflow Architecture

## Model Shape

```ts
export class SomeModel extends Model.Service<SomeModel>()("unit/key")<Key>()({
  make: (key) =>
    Effect.gen(function* () {
      return {
        inputs: {},
        outputs: {},
        ui: {},
      };
    }),
}) {}
```

Singleton models omit `<Key>()`. Keyed models use flat plain-data keys.

## Ports

- `inputs`: write-only sinks for parents, routes, persistence, and tests.
- `outputs`: read-only sources/events for model composition.
- `ui`: store sources, event sinks, and nested unit ports for React Views.

The owner model keeps the full descriptors. Outside code receives narrowed
capabilities.

## React

```tsx
export const SomeView = View.make(SomeModel, (units) => (
  <Panel value={units.view.value} onChange={units.setValue} />
));
```

Views may bind `ui` only. If JSX needs derived state, publish a `view` store
from the model instead of computing in the component.

## Async

- Read RPC: `Query.make(...)`.
- Paginated read: `Query.makeInfinite({ initialCursor, handler })` — the
  handler returns `{ data, next: Option<Cursor> }`, the query gains
  `loadMore` / `hasMore`.
- Write RPC with visible lifecycle: `Mutation.make(...)`.
- Streaming RPC: `Registry.run(stream.pipe(...))` and write progress to stores.
- Failures become data in stores; long-running pipelines should not fail the
  owning stream.

## Lifetime

Parent models own child models they get with `Model.get`. React can own root
models. The target lifetime design is scope-based ownership: closing the parent
scope releases its child references; the last released owner closes the child
scope.
