---
title: Lifetime and Finalizers
description: Model ownership, idle TTL, Model.list disposal, Registry scope, and cleanup hooks.
---

Unitflow model instances are scoped and lease-counted.

```txt
Model.get(Model, key) -> lease a shared instance in the caller scope
caller scope closes   -> release that lease
last lease releases   -> model lifetime policy decides when to dispose
```

Stores, events, handlers, `Registry.run` pipelines, queries, and mutations
created inside `make` belong to that model instance.

## Defaults

Singleton models live until `Model.dispose(...)` or registry shutdown.

```ts
export class SessionModel extends Model.Service<SessionModel>()(
  "docs/session",
)({
  make: Effect.gen(function* () {
    return { inputs: {}, outputs: {}, ui: {} };
  }),
}) {}
```

Keyed models default to a 10 minute idle TTL after the last lease is released.
If the same key is requested again before the TTL expires, the existing state is
reused.

```ts
export class TaskModel extends Model.Service<TaskModel>()(
  "docs/task",
)<{ readonly id: string }>()({
  make: ({ id }) =>
    Effect.gen(function* () {
      const title = Store.make(`Task ${id}`);
      return { inputs: {}, outputs: { title }, ui: { title } };
    }),
}) {}
```

## Lifetime Option

Override the default with `lifetime`.

```ts
export class ShortLivedPanel extends Model.Service<ShortLivedPanel>()(
  "docs/short-lived-panel",
)<string>()({
  lifetime: { idleTimeToLive: "1 minute" },
  make: () =>
    Effect.gen(function* () {
      return { inputs: {}, outputs: {}, ui: {} };
    }),
}) {}
```

Pin a keyed model with `"keepAlive"`.

```ts
export class CachedDictionary extends Model.Service<CachedDictionary>()(
  "docs/cached-dictionary",
)<string>()({
  lifetime: "keepAlive",
  make: () =>
    Effect.gen(function* () {
      return { inputs: {}, outputs: {}, ui: {} };
    }),
}) {}
```

## Parent Ownership

When a parent calls `Model.get(ChildModel, key)` during `make`, the child lease
lives in the parent's instance scope.

```ts
const child = yield* Model.get(TaskModel, { id: "task-1" });

return {
  inputs: {},
  outputs: { title: child.outputs.title },
  ui: { child },
};
```

Disposing the parent releases its child leases. A TTL child may continue until
its idle timeout; a keepAlive child stays alive.

## Model.list Ownership

`Model.list(ChildModel)` is for dynamic child collections owned by a parent.

```ts
const tasks = yield* Model.list(TaskModel);

yield* tasks.push({ id: "task-1" });
yield* tasks.remove({ id: "task-1" });
```

Removing a child releases this list's ownership. If no other holder owns that
child, the child is disposed immediately, without waiting for its TTL. If
another holder owns it, the child remains alive for that holder.

## Manual Dispose

`Model.dispose(Model, key)` force-closes the instance now, even if leases are
still outstanding. A later `Model.get` constructs a fresh instance with fresh
state.

```ts
yield* Model.dispose(TaskModel, { id: "task-1" });
```

Use manual dispose for explicit destructive lifecycle events, not for routine
parent-child ownership.

## Finalizers

Inside `make`, Effect's ambient scope is the model instance scope. Use
`Effect.addFinalizer` for resources that must close with the model.

```ts
const socket = yield* openSocket();

yield* Effect.addFinalizer(() =>
  socket.close.pipe(
    Effect.catchAll(() => Effect.void),
  ),
);
```

The finalizer runs when the model instance is disposed: idle timeout,
`Model.dispose`, parent/list disposal for sole-owned children, or registry
shutdown.

Use finalizers for external handles such as sockets, subscriptions, workers,
and imperative libraries. Stores, events, queries, mutations, and
`Registry.run` pipelines already attach their cleanup to the owner scope.

## Registry Lifetime

A `Registry.layer` owns the runtime world for one app runtime or one test. When
the registry shuts down, all model instances and their finalizers shut down.

React runtimes call this through `runtime.dispose()`. Tests usually provide a
fresh `Registry.layer` per test and let the test scope close it.
