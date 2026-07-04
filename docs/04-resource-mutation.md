# Resource and Mutation

`Resource` is the core primitive for async reads. `Mutation` is the matching
recipe for observable writes.

## Resource

Use Resource for async reads.

```ts
const projects = yield* Resource.make(client.projectsList());

const filtered = yield* Resource.make({
  stores: { query },
  handler: ({ query }) => client.searchProjects({ query }),
});

const refreshProjects = projects.refresh;
const projectState = projects.state;
```

Return `resource.state` from `ui` or `outputs` to expose the current
`AsyncResult`. Refreshes keep the previous success while waiting or after a
failed reload, so flaky reads do not blank the screen.

Use `Resource.refetchOn(...)`, `Resource.repeat(schedule)`, or
`Resource.paginated(...)` when a read should reload from events, time, or
load-more pagination.

## Mutation

Use Mutation for observable writes.

```ts
const save = yield* Mutation.make((input: SaveInput) => client.saveProject(input));
const saveState = save.state;
const savedProjects = save.done;

const saveAndRefresh = yield* Mutation.make((input: SaveInput) =>
  client.saveProject(input),
).pipe(Mutation.invalidates(projects));

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
