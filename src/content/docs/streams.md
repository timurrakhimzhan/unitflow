---
title: Streams and Registry Runs
description: Advanced stream pipelines for debounce, filtering, merging, schedules, and long-running sources.
---

Most connections should start with `Event.handler`.

Use streams when the connection itself is stream-shaped: filter, map, merge,
debounce, throttle, dedupe, schedule, or consume a long-running source.

## Registry.run

`Registry.run(stream)` forks a stream pipeline into the current owner scope.
Inside a model, that owner is the model instance. Outside a model, it is the
registry scope.

```ts
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Event, Registry } from "@unitflow/core";

const textChanged = Event.make<string>();
const searchRequested = Event.make<string>();

yield* Registry.run(
  Event.stream(textChanged).pipe(
    Stream.map((text) => text.trim()),
    Stream.filter((text) => text.length >= 2),
    Stream.debounce("300 millis"),
    Stream.mapEffect((query) => Event.emit(searchRequested, query)),
  ),
);
```

The stream error channel must be `never`. If a step can fail, catch the failure
inside the pipeline and write it to state or emit an event.

```ts
yield* Registry.run(
  Event.stream(searchRequested).pipe(
    Stream.mapEffect((query) =>
      fetchResults(query).pipe(
        Effect.catchCause((cause) => Store.set(error, cause)),
      ),
    ),
  ),
);
```

## Event Streams

`Event.stream(event)` subscribes to future emissions. It does not replay events
that happened before the subscription attached.

```ts
yield* Registry.run(
  Event.stream(saved).pipe(
    Stream.mapEffect((project) =>
      Effect.log(`saved ${project.id}`),
    ),
  ),
);
```

Use `Event.combine([a, b])` when several event sources should feed the same
pipeline.

```ts
const changed = Event.combine([saved, removed]);

yield* Registry.run(
  Event.stream(changed).pipe(
    Stream.mapEffect(() => Event.emit(projects.refresh)),
  ),
);
```

## Store Streams

`Store.stream(source)` emits the current value first, then later changes.

```ts
yield* Registry.run(
  Store.stream(tableState).pipe(
    Stream.changes,
    Stream.mapEffect((snapshot) =>
      Effect.log(`visible rows: ${snapshot.rows.length}`),
    ),
  ),
);
```

Use `Store.changed(source)` when you specifically want an event that skips the
current value and emits only future changes.

## Handler or Stream

Prefer `Event.handler` when the shape is direct.

```ts
const submit = yield* Event.make<Form>().pipe(
  Event.handler((form) => save(form)),
);
```

Prefer `Registry.run` when the stream operators are the point.

```ts
yield* Registry.run(
  Event.stream(textChanged).pipe(
    Stream.debounce("300 millis"),
    Stream.mapEffect((text) => Event.emit(searchRequested, text)),
  ),
);
```

Do not use `Stream.mapEffect(..., { concurrency })` to make event handlers
concurrent. Use `Event.handler(fn, { concurrency: "unbounded" })` for that case.
