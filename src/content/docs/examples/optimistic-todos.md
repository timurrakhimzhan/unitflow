---
title: Optimistic Todos
description: Optimistic updates with rollback, built from plain Store and Mutation code — no dedicated API.
---

A todo list where a new item appears instantly, long before the server
confirms it. Optimistic updates need no dedicated API in Unitflow:
`query.state` is an ordinary writable store owned by the same model as the
mutation, so the handler applies the change, calls the mutation, and refetches
on either outcome.

Runnable app: `examples/ts/optimistic-todos` — it ships a "fail the next
save" toggle so the rollback is watchable.

## Model

```ts
const todos = yield* Query.make(
  Effect.gen(function* () {
    const api = yield* TodosApi;
    return (yield* api.list()) as ReadonlyArray<TodoRow>;
  }),
);

const save = yield* Mutation.make((input: { title: string; fail: boolean }) =>
  Effect.gen(function* () {
    const api = yield* TodosApi;
    return yield* api.save(input);
  }),
);

const submit = yield* Event.make<void>().pipe(
  Event.handler(() =>
    Effect.gen(function* () {
      const title = (yield* Store.get(draft)).trim();
      if (title === "") return;
      const fail = yield* Store.get(simulateFailure);
      yield* Store.set(draft, "");

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

      // Either way the server is the source of truth: confirm on success,
      // roll back on failure — both are just a refresh.
      yield* Mutation.call(save.run, { title, fail }).pipe(
        Effect.flatMap(() => Event.emit(todos.refresh)),
        Effect.catchCause(() => Event.emit(todos.refresh)),
      );
    }),
  ),
);
```

The optimistic row carries a `pending` marker, so the View can render it
dimmed with a "saving…" note until the refetch replaces it with the server
row.

## View

```tsx
{todos.value.map((todo) => (
  <li key={todo.id} className={todo.pending === true ? "pending" : ""}>
    <span>{todo.title}</span>
    {todo.pending === true ? <em>saving…</em> : null}
  </li>
))}

{AsyncResult.isFailure(unit.saveState) ? (
  <div role="alert">Save failed — the optimistic todo was rolled back.</div>
) : null}
```

The failure banner comes straight from the mutation's `state` — no extra
error plumbing.

## Why refetch instead of snapshot rollback

Refetching on both outcomes keeps the list always consistent with the server.
The alternative — snapshot `Store.get(todos.state)` before the optimistic
write and `Store.set` it back on failure — rolls back instantly and works
offline, but can overwrite a concurrent refresh that landed in between.
Prefer the refetch variant unless the round trip is noticeable.
