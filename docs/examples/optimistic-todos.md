# Example: Optimistic Todos

A todo list where a new item appears instantly, long before the server
confirms it. No dedicated API: `query.state` is an ordinary writable store in
the same model as the mutation.

```ts
// Apply the change to the query state before the server confirms.
yield* Store.update(todos.state, (current) =>
  Option.match(AsyncResult.value(current), {
    onNone: () => current,
    onSome: (list) =>
      AsyncResult.success<ReadonlyArray<TodoRow>>([
        ...list,
        { id: `pending:${title}`, title, pending: true },
      ]),
  }),
);

// Either way the server is the source of truth.
yield* Mutation.call(save.run, { title, fail }).pipe(
  Effect.flatMap(() => Event.emit(todos.refresh)),
  Effect.catchCause(() => Event.emit(todos.refresh)),
);
```

The optimistic row carries a `pending` marker for the View; the failure
banner reads the mutation's `state`. Snapshot-and-restore is the instant
alternative to the failure refetch, at the cost of possibly overwriting a
concurrent refresh.

Runnable app: `examples/ts/optimistic-todos` (with a "fail the next save"
toggle to watch the rollback).
