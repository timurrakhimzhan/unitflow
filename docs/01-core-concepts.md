# Core Concepts

## Stores

A store is state owned by a model instance.

```ts
const count = Store.make(0);

const current = yield* Store.get(count);
yield* Store.set(count, 1);
yield* Store.update(count, (value) => value + 1);

const doubled = count.pipe(Store.map((value) => value * 2));
```

Use `Store.changed` when later store changes should trigger model logic.

```ts
const countChanged = yield* count.pipe(Store.changed);

yield* countChanged.pipe(
  Event.handler((value) => Effect.log(`count changed to ${value}`)),
);
```

Use `Store.persist({ key, schema, timeToLive? })` to keep a store's value in
a `KeyValueStore` across sessions. Hydration is inline — the returned store
already holds the restored value, so a dependent query loads once with it.
Best-effort, same rules as `Query.persist`: decode failures and expired
entries are misses, storage errors are logged and swallowed. Match the schema
to the store's exact type — a literal-union store needs `Schema.Literals`,
the schema is the only runtime guard against stale stored shapes.

```ts
const language = yield* Store.make<"all" | "rust">("all").pipe(
  Store.persist({ key: "language", schema: Schema.Literals(["all", "rust"]) }),
);
```

## Events

An event is a model action.

```ts
const increment = yield* Event.make<number>().pipe(
  Event.handler((amount) =>
    Store.update(count, (value) => value + amount),
  ),
);

yield* Event.emit(increment, 1);
```

Use `Event.handler` for direct reactions. Use streams only when the connection
needs operators such as filtering, debouncing, merging, schedules, or
long-running producers.

## Model Wiring

Parents connect child outputs to parent state or parent outputs.

```ts
const picker = yield* Model.get(ProjectPickerModel, { id: "project-picker" });
const selected = Event.make<ProjectId>();

yield* picker.outputs.selected.pipe(
  Event.handler((id) => Event.emit(selected, id)),
);

return {
  inputs: {},
  outputs: { selected },
  ui: { picker },
};
```
