# Unitflow Testing

Use a fresh registry/runtime layer per test.

```ts
it.effect("updates state", () =>
  Effect.gen(function* () {
    const model = yield* Model.get(SomeModel, key);

    yield* Registry.allSettled(Event.emit(model.inputs.submit, value));

    assert.deepStrictEqual(yield* Store.get(model.outputs.state), expected);
  }).pipe(Effect.provide(testLayer)),
);
```

## Rules

- Drive only `inputs` or `ui` actions.
- Assert only `outputs` or `ui` state.
- Wrap actions in `Registry.allSettled(...)`.
- Use `Store.waitFor` or `Event.waitFor` only for intermediate states or
  intentionally non-settling flows.
- Mock child models through layers/ports, not module mocks.
- Do not use `registry.mount(...)`, `flush()`, or `Effect.runSync`.

## Child Model Mock

```ts
const child = {
  inputs: { submit: Event.make<Input>() },
  outputs: { changed: Event.make<Changed>() },
  ui: { view: Store.make(initialView) },
};

const layer = ParentModel.layer.pipe(
  Layer.provideMerge(Model.layerValue(ChildModel, child)),
  Layer.provideMerge(Registry.layer),
);
```
