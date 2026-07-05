# Testing

Unitflow tests run models, not React.

```ts
it.effect("increments", () =>
  Effect.gen(function* () {
    const counter = yield* Model.get(CounterModel);

    yield* Registry.allSettled(
      Event.emit(counter.inputs.increment, 3),
    );

    assert.strictEqual(yield* Store.get(counter.outputs.count), 3);
  }).pipe(Effect.provide(testLayer)),
);
```

Rules:

- Provide a fresh `Registry.layer` per test.
- Drive through `inputs` or `ui` events.
- Assert through `outputs` or `ui` stores.
- Wrap command triggers in `Registry.allSettled(...)`.
- Fork `Event.waitFor` before emitting the expected event.
- Mock child models with `Model.layerValue(...)`.

Avoid manual mounting, generic flush helpers, and `Effect.runSync(...)` tests
that reach around the model contract.
