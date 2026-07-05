---
title: Testing
description: Test models directly with Effect layers, fake services, Event.emit, Store.get, and Registry.allSettled.
---

Unitflow tests run models, not React.

Build a small Effect layer, provide fake services or fake child models, trigger
model actions, and assert model state. The rest of the application does not
need to exist.

## Basic Test

```ts
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Event, Model, Registry, Store } from "@unitflow/core";
import { CounterModel } from "./model";

const testLayer = CounterModel.layer.pipe(
  Layer.provideMerge(Registry.layer),
);

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

`Registry.allSettled` runs the trigger, then waits until the store and event
work caused by that trigger has finished.

## Replace Dependencies

Because models are Effect services, tests can replace regular services through
layers.

```ts
const testLayer = ProjectsModel.layer.pipe(
  Layer.provideMerge(FakeProjectApi.layer),
  Layer.provideMerge(Registry.layer),
);
```

Use the same pattern for clocks, configs, telemetry, HTTP clients, schemas, or
any other Effect service.

## Replace Child Models

Use `Model.layerValue(...)` when the parent model should see a fake child.

```ts
import { vi } from "vitest";

const submitSpy = vi.fn<(input: Input) => void>();

const submit = yield* Event.make<Input>().pipe(
  Event.handler((input) => Effect.sync(() => submitSpy(input))),
);
const submitted = Event.make<Submitted>();
const childState = Store.make(initialChildState);

const child = {
  inputs: { submit },
  outputs: { submitted },
  ui: { childState, submit },
};

const layer = ParentModel.layer.pipe(
  Layer.provideMerge(Model.layerValue(ChildModel, child)),
);
```

The parent still resolves `ChildModel` through Effect dependency injection, but
the test controls what that child returns. Use the spy to assert calls into the
fake child, and emit `submitted` when the test needs the child to notify the
parent. Provide `Registry.layer` around the test so the fake child handlers and
the parent model share the same registry.

## Awaiting Values

`Registry.allSettled` waits for the action cascade to finish.
Use `Store.waitFor` or `Event.waitFor` when an Effect needs to block until a
specific store value or event emission appears.

## Rules

- Provide a fresh `Registry.layer` per test.
- Trigger behavior through `inputs` or `ui` actions.
- Assert through `outputs` or `ui` state.
- Wrap action triggers in `Registry.allSettled(...)`.
- Start `Event.waitFor` before the trigger that may emit the event.
- Replace services with layers.
- Replace child models with `Model.layerValue(...)`.

## Avoid

```ts
registry.mount(model.outputs.event);
await flush();
Effect.runSync(...);
```

If a test needs these, the model or test is likely bypassing the public model
contract.
