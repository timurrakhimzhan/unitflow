# Model

A model is a UI-facing Effect Service. It owns state, actions, async work, child
models, and lifetime.

```ts
export class CounterModel extends Model.Service<CounterModel>()("docs/counter")({
  make: Effect.gen(function* () {
    const count = Store.make(0);
    const increment = yield* Event.make<void>().pipe(
      Event.handler(() => Store.update(count, (value) => value + 1)),
    );

    return {
      inputs: { increment },
      outputs: { count },
      ui: { count, increment },
    };
  }),
}) {}
```

`inputs` are actions for parents, routes, persistence, and tests. `outputs` are
state or events for parent models, tests, and analytics. `ui` is the complete
render surface for `View.make`.

`ui` is optional: a headless model — a service other models resolve, with no
screen of its own — returns only `inputs`/`outputs`. `View.make` requires a
model with a `ui` section (`Model.Viewable`), so binding a headless model to a
View fails to compile.

Inside `make`, the model can use regular Effect services and child models:

```ts
const api = yield* ProjectApi;
const child = yield* Model.get(ChildModel);
```

Both are provided through layers, so tests can replace services or child models
with fakes.

Keyed models use `<Key>()` and flat keys.

```ts
export class TaskModel extends Model.Service<TaskModel>()("docs/task")<{
  readonly id: string;
}>()({
  make: ({ id }) =>
    Effect.gen(function* () {
      const title = Store.make(`Task ${id}`);
      return { inputs: {}, outputs: { title }, ui: { title } };
    }),
}) {}
```

Dynamic child collections use `Model.list(ChildModel)`.
