# Mutations

Use `Mutation` for model-owned async writes with visible waiting, failure,
success events, typed calls, or invalidation.

```ts
const save = yield* Mutation.make((input: SaveInput) =>
  saveProject(input),
);

return {
  inputs: { save: save.run },
  outputs: { saved: save.done },
  ui: {
    save: save.run,
    saveState: save.state,
  },
};
```

`save.run` is the action that starts the write. Fire it from UI/tests with
`Event.emit(save.run, input)`. Use `Mutation.call(save.run, input)` when model
logic or a test needs the typed result or typed failure.

Successful mutations write success state and emit `done`. Failed mutations
write failure state and do not emit `done`.

Use `Mutation.invalidates(query)` to refresh queries after successful
writes.

Optimistic updates need no dedicated API: `query.state` is an ordinary
writable store in the same model, so the handler applies the change to it
before calling the mutation, and refetches on either outcome — the server is
the source of truth.

```ts
const submit = yield* Event.make<TodoInput>().pipe(
  Event.handler((input) =>
    Effect.gen(function* () {
      yield* Store.update(todos.state, (current) =>
        Option.match(AsyncResult.value(current), {
          onNone: () => current,
          onSome: (list) => AsyncResult.success([...list, optimisticTodo(input)]),
        }),
      );
      yield* Mutation.call(save.run, input).pipe(
        Effect.flatMap(() => Event.emit(todos.refresh)),
        Effect.catchCause(() => Event.emit(todos.refresh)),
      );
    }),
  ),
);
```

For instant rollback without a refetch, snapshot `Store.get(todos.state)`
first and `Store.set` it back on failure — offline-friendly, but it can
overwrite a concurrent refresh; prefer the refetch variant unless the round
trip is noticeable.
