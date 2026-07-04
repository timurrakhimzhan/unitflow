# Testing

Unitflow tests run models, not React.

```ts
it.effect("saves on submit", () =>
  Effect.gen(function* () {
    const form = yield* Model.get(FormModel, { id: "a" });

    yield* Registry.allSettled(Event.emit(form.inputs.submit, value));

    assert.deepStrictEqual(yield* Store.get(form.outputs.state), expected);
  }).pipe(Effect.provide(testLayer)),
);
```

## Rules

- Provide a fresh `Registry.layer` per test.
- Drive through `inputs` or `ui` events.
- Assert through `outputs` or `ui` stores.
- Wrap actions in `Registry.allSettled`.
- Use `Store.waitFor` / `Event.waitFor` only for intermediate states or flows
  that intentionally do not quiesce.
- Mock child models with model layers, not module mocks.

## Anti-patterns

```ts
registry.mount(model.outputs.event);
await flush();
Effect.runSync(...);
```

If a test needs these, the model/test contract is probably leaking runtime
internals.
