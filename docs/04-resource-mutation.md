# Resource and Mutation

`Resource` is the core primitive for async reads. `Mutation` is the matching
recipe for observable writes.

## Resource

Use Resource for async reads.

```ts
const projects = yield* Resource.make({
  handler: () => client.projectsList(),
});

const filtered = yield* Resource.make({
  stores: { query },
  handler: ({ query }) => client.searchProjects({ query }),
}).pipe(Resource.debounce("250 millis"));

const reloadProjects = projects.reload;
```

The resource is store-shaped, so returning it in `ui` or `outputs` exposes the
current `AsyncResult`. Render `_tag` (`Waiting`, `Success`, `Failure`), not
nullable data plus separate booleans.

`Resource.debounce` debounces reloads caused by dependency store changes. The
initial load and explicit `resource.reload` event stay immediate.

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
