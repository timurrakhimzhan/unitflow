# Core Concepts

## Model

A model is an Effect service that returns ports.

```ts
export class ProjectPickerModel extends Model.Service<ProjectPickerModel>()(
  "features/project-picker",
)<ProjectPickerKey>()({
  make: (key) =>
    Effect.gen(function* () {
      const projects = yield* Model.get(ProjectsEntityModel);
      const selected = Event.make<ProjectPickerEvent>();

      return {
        inputs: {},
        outputs: { selected },
        ui: {},
      };
    }),
}) {}
```

Singleton models omit the key parameter. Dynamic models use a flat, plain-data
key so equivalent keys resolve the same instance.

## Store

A Store is scoped state owned by the registry, not a global singleton.

```ts
const open = Store.make(false);
const canSave = Store.combine([dirty, saving], (dirty, saving) => dirty && !saving);
const setOpen = Event.setter(open);
```

Public model ports narrow capabilities:

- `inputs`: sink-capable ports
- `outputs`: source-capable ports
- `ui`: source values and event sinks for rendering

## Event

An Event is a streamable discrete message.

```ts
const save = yield* Event.make<SaveRequest>().pipe(
  Event.handler((request) => persist(request)),
);
```

Use `Event.handler` for "on event, run this Effect". Use `Registry.run` for
stream-shaped logic such as filtering, combining, debouncing, or listening to
another model's outputs.

## Registry

A Registry owns stores, event channels, fibers, and model instances for one
runtime/test scope.

Tests should drive models like users or parent models do:

```ts
yield* Registry.allSettled(Event.emit(model.inputs.submit, value));
assert.deepStrictEqual(yield* Store.get(model.outputs.state), expected);
```

No manual port mounting. No generic flush helpers.
