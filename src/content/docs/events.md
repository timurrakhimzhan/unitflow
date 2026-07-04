---
title: Events
description: Streamable discrete messages, handlers, and registry pipelines.
---

An Event is a streamable discrete message. Use events for actions, facts, and
control ports.

Events are not callbacks as the orchestration model. A View may receive an event
sink as a callback, but inside the model the event is still a typed stream.

## Create And Emit

```ts
const opened = yield* Event.make<void>();
const renamed = yield* Event.make<string>();

yield* Event.emit(opened, undefined);
yield* Event.emit(renamed, "Main lobby");
```

Events can be exposed as inputs, outputs, or UI callbacks depending on who is
allowed to emit or observe them.

## Handler

Use `Event.handler` when one event should run one Effect.

```ts
const increment = yield* Event.make<number>().pipe(
  Event.handler((amount) => Store.update(count, (current) => current + amount)),
);
```

Handlers can update stores and emit other events.

```ts
const selected = yield* Event.make<ProjectTarget>();
const committed = yield* Event.make<ProjectTarget>();

const select = yield* Event.make<ProjectTarget>().pipe(
  Event.handler((target) =>
    Effect.gen(function* () {
      yield* Store.set(currentTarget, target);
      yield* Event.emit(selected, target);
      yield* Event.emit(committed, target);
    }),
  ),
);
```

Keep async read/write state out of basic event examples. If a flow needs
waiting, success, failure, retries, or visible async state, move that logic to
`Resource` or `Mutation`.

## Registry Pipelines

Use `Registry.run` when the logic is naturally stream-shaped: filtering,
mapping, deduping, debouncing, merging, or wiring one event into another.

```ts
const textChanged = yield* Event.make<string>();
const textCommitted = yield* Event.make<string>();

yield* Registry.run(
  Event.stream(textChanged).pipe(
    Stream.map((text) => text.trim()),
    Stream.filter((text) => text.length > 0),
    Stream.mapEffect((text) => Event.emit(textCommitted, text)),
  ),
);
```

This keeps the flow readable as a stream instead of hiding it inside a callback.

## Connect Model Outputs

Parent models can connect child outputs to parent inputs or outputs through the
same stream API.

```ts
const child = yield* Model.get(ChildModel, childKey);
const childSubmitted = yield* Event.make<SubmitPayload>();

yield* Registry.run(
  Event.stream(child.outputs.submitted).pipe(
    Stream.map((payload) => normalizeSubmitPayload(payload)),
    Stream.mapEffect((payload) => Event.emit(childSubmitted, payload)),
  ),
);
```

This is model composition, not UI logic. The View still only receives declared
`ui` ports.
