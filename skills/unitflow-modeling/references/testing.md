# Unitflow Testing

Unitflow tests drive models, not React. Resolve the model from a test layer,
emit a public action, wait for Unitflow-owned work to settle, then assert the
public state.

## Basic Pattern

```ts
it.effect("updates state", () =>
  Effect.gen(function* () {
    const model = yield* Model.get(SomeModel, key);

    yield* Registry.allSettled(Event.emit(model.inputs.submit, value));

    assert.deepStrictEqual(yield* Store.get(model.outputs.state), expected);
  }).pipe(Effect.provide(testLayer)),
);
```

Use a fresh `Registry.layer` in the test layer. Add fake Effect services or
fake child models there, the same way production adds real layers.

## What To Drive

- Drive `inputs` when testing model composition or external commands.
- Drive `ui` actions when testing the same path a View uses.
- Assert `outputs` for model contracts.
- Assert `ui` state only when the render surface is the behavior under test.

`Registry.allSettled(...)` waits for the Unitflow work caused by the action:
event handlers, registry stream pipelines, queries, mutations, and store
reactions. After it returns, assert with `Store.get(...)`.

## Async Reads And Writes

For a query, provide a fake service layer, resolve the model, let construction
or `refresh` settle, then assert the query state.

For a mutation, emit or call the mutation's public `run` action, settle, then
assert its `state` or any `done`/output event the model exposes.

For intentionally long-lived pipelines, start a `Store.waitFor(...)` or
`Event.waitFor(...)` before the action that should satisfy it.

## Child Model Mock

Replace child models with ports through layers. Do not module-mock the child.

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
