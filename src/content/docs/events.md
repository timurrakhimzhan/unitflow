---
title: Events
description: Model actions with Event.make, Event.emit, Event.handler, combining, and waiting.
---

An event is a model action.

Use events for things that happen at a point in time: rename, submit, remove,
open, retry, saved. Stores hold current state; events trigger model behavior.

## Create and Emit

`Event.make` creates the action. `Event.emit` fires it from another Effect, a
parent model, or a test.

```ts
import { Event } from "@unitflow/core";

const renamed = Event.make<string>();
const submitted = Event.make<void>();

yield* Event.emit(renamed, "Lobby refresh");
yield* Event.emit(submitted);
```

Inside a React View, actions returned from `ui` are rendered as functions.

```tsx
<button type="button" onClick={() => submitted()}>
  Submit
</button>
```

## Handle

Use `Event.handler` for the common case: when an action fires, run one Effect.

```ts
import * as Effect from "effect/Effect";
import { Event, Store } from "@unitflow/core";

const count = Store.make(0);

const increment = yield* Event.make<number>().pipe(
  Event.handler((amount) =>
    Store.update(count, (value) => value + amount),
  ),
);
```

Handlers run sequentially by default. If `increment` fires twice, the second
handler waits for the first one.

If the work can fail, handle the error inside the handler and turn it into
state or another event. A handler is an owned model pipeline and should keep
running.

```ts
const error = Store.make<string | null>(null);

const submit = yield* Event.make<string>().pipe(
  Event.handler((name) =>
    saveName(name).pipe(
      Effect.catchTag("SaveError", (cause) =>
        Store.set(error, cause.message),
      ),
    ),
  ),
);
```

## Handle Independently

When every emission can run independently, use the built-in concurrency option.

```ts
const preload = yield* Event.make<string>().pipe(
  Event.handler(
    (url) => cacheImage(url),
    { concurrency: "unbounded" },
  ),
);
```

Use this instead of writing a custom concurrent stream pipeline for ordinary
action handling.

## Publish Another Event

An event handler can emit another event when the model wants to announce a
result.

```ts
const saved = Event.make<Project>();

const submit = yield* Event.make<ProjectDraft>().pipe(
  Event.handler((draft) =>
    Effect.gen(function* () {
      const project = yield* createProject(draft);
      yield* Event.emit(saved, project);
    }),
  ),
);
```

Expose `submit` when outside code may start the save. Expose `saved` when
outside code may observe successful saves.

## Forward Into Another Event

Use `Event.forwardTo(sink)` to relay every occurrence of one event into
another model's input port, without hand-rolling
`Event.stream(...).pipe(Stream.mapEffect(...))`. The target is the CHILD's
already-narrowed `Sink` — reached through `Model.get`, never the child's own
local `Event.input()` value (that one stays read-only, on purpose — see
[Model](./model.mdx)).

```ts
import { Model } from "@unitflow/core";
import { ChildModel } from "./child-model";

const saved = Event.make<Project>();
const child = yield* Model.get(ChildModel);

yield* saved.pipe(Event.forwardTo(child.inputs.projectSaved));
```

It is pipeable and data-last, and forks into the enclosing model's scope like
`Registry.run` — set it up once during `make`, it runs for the model's whole
lifetime. It also accepts anything that resolves to an event, so it chains
directly off `Store.changed`:

```ts
yield* selectedProject.pipe(Store.changed, Event.forwardTo(child.inputs.selectionChanged));
```

`Store.forwardTo(sink)` is the store-shaped twin — see
[Forward Into Another Store or Event](./store.md#forward-into-another-store-or-event).

## Combine

`Event.combine` merges several events into one observable event.

```ts
const saved = Event.make<Project>();
const removed = Event.make<ProjectId>();

const changed = Event.combine([saved, removed]);
```

Use a combined event when several actions should trigger the same follow-up
logic.

```ts
yield* changed.pipe(
  Event.handler(() => Event.emit(projects.refresh)),
);
```

## Awaiting Events

Use `Event.waitFor(event)` when an Effect needs to block until the next event
emission. Start the wait before the action that may emit the event.

For ordinary model wiring, prefer `Event.handler`. For filtering, debouncing,
merging, or longer pipelines, use [Streams and Registry Runs](./streams.md).
