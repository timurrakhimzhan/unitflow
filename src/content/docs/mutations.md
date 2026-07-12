---
title: Mutations
description: Observable async writes with typed calls, UI triggers, success events, and invalidation.
---

Use `Mutation` for async writes that need visible progress, failure, result
state, or a success event. The handler is a normal Effect, so it can use
dependency injection, typed errors, interruption, retry, timeout, schemas, and
any other Effect primitive.

A mutation owns:

```ts
{
  run;   // action that starts the write
  state; // AsyncResult for waiting, failure, and latest success
  done;  // event emitted after a successful write
}
```

`state` starts as `AsyncResult.initial(false)`. It becomes waiting while the
handler runs. On success, the mutation writes `AsyncResult.success(value)` and
emits `done`. On failure, it writes failure state, keeps the previous value if
there was one, and does not emit `done`.

## Create a Mutation

```ts
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { Model, Mutation } from "@unitflow/core";

interface SaveInput {
  readonly name: string;
}

interface Project {
  readonly id: number;
  readonly name: string;
}

class SaveError extends Data.TaggedError("SaveError")<{
  readonly message: string;
}> {}

const saveProject = (input: SaveInput) =>
  input.name.trim() === ""
    ? Effect.fail(new SaveError({ message: "Name is required" }))
    : Effect.succeed({ id: 1, name: input.name });

export class ProjectFormModel extends Model.Service<ProjectFormModel>()(
  "docs/project-form",
)({
  make: () => Effect.gen(function* () {
    const save = yield* Mutation.make(saveProject);

    return {
      inputs: { save: save.run },
      outputs: { saved: save.done },
      ui: {
        save: save.run,
        saveState: save.state,
      },
    };
  }),
}) {}
```

`save.run` is the action that starts the write. A View can fire it. A parent or
test can emit it. It is not observable as an event stream.

## Fire and Forget

Use `Event.emit(mutation.run, input)` when you want the UI path: trigger the
write, update mutation state, emit `done` on success, and do not await the
typed result.

```ts
yield* Registry.allSettled(
  Event.emit(form.inputs.save, { name: "Loft" }),
);
```

Failures are recorded in `save.state`.

## Typed Call

Use `Mutation.call(...)` when model logic or a test needs the result or typed
failure.

```ts
const project = yield* Mutation.call(form.inputs.save, { name: "Loft" });
```

`Mutation.call` runs through the same state transitions and emits `done` on
success.

```ts
const result = yield* Mutation.call(form.inputs.save, { name: "Loft" }, {
  timeout: "5 seconds",
});
```

When a timeout is passed, the error channel can also contain
`Cause.TimeoutError`.

## Serialize Writes

Each mutation has one internal permit. Concurrent `Event.emit` and
`Mutation.call` triggers queue behind one another and run the handler one at a
time.

Use separate child models when many independent rows need independent visible
mutation lifecycles.

## Invalidate Reads

Use `Mutation.invalidates(...)` to refresh queries or any target with a
`refresh` action after successful writes.

```ts
const projects = yield* Query.make(fetchProjects);

const save = yield* Mutation.make(saveProject).pipe(
  Mutation.invalidates(projects),
);
```

Invalidation runs after `done`, so failed writes do not refresh targets.

## Optimistic Updates

No dedicated API: `query.state` is an ordinary writable store owned by the
same model as the mutation, so the handler applies the change before the
server confirms, and refetches on either outcome — the server is the source
of truth.

```ts
yield* Store.update(todos.state, (current) =>
  Option.match(AsyncResult.value(current), {
    onNone: () => current,
    onSome: (list) => AsyncResult.success([...list, optimisticTodo(input)]),
  }),
);

yield* Mutation.call(save.run, input).pipe(
  Effect.flatMap(() => Event.emit(todos.refresh)),
  Effect.catchCause(() => Event.emit(todos.refresh)),
);
```

The full pattern — a pending marker on the optimistic row, the failure banner
from the mutation's `state`, and the snapshot-rollback alternative — lives in
the [Optimistic Todos example](/examples/optimistic-todos/).

## Choosing the Primitive

```txt
Event.handler  -> direct reaction, no owned async lifecycle
Query          -> model-owned async read
Mutation       -> model-owned async write
Plain Effect   -> local one-shot work with no public state
```

If the UI should show waiting, failure, or the last result of a write, use a
mutation. If only the current caller needs the result, a plain Effect helper is
enough.
