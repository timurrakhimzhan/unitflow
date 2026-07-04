---
title: Resource and Mutation
description: Async read and write recipes built over Store, Event, and Effect.
---

`Resource` and `Mutation` are recipes over `Store`, `Event`, and `Effect`.
They come after the basic Store/Event layer: use them when an async read or
write needs visible state, progress, failure, retries, or deterministic tests.

## Resource

Use Resource for async reads.

```ts
const projects = yield* Resource.make({
  handler: () => client.projectsList(),
});

const filtered = yield* Resource.make({
  stores: { query },
  handler: ({ query }) => client.searchProjects({ query }),
});
```

The resource state is an `AsyncResult`: render `_tag`/`waiting`, not nullable
data plus separate booleans.

## Mutation

Use Mutation for observable writes.

```ts
const save = yield* Mutation.make((input: SaveInput) => client.saveProject(input));

const submit = yield* Event.make<SaveInput>().pipe(
  Event.handler((input) =>
    Mutation.call(save.run, input).pipe(
      Effect.flatMap((result) => Store.set(saved, result)),
      Effect.catchCause((cause) => Store.set(error, causeMessage(cause))),
    ),
  ),
);
```

Use a plain Effect helper when the result is only needed locally. Use child
models when many parallel visible lifecycles are needed.
