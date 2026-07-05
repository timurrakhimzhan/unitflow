# Lifetime and Finalizers

`Model.get(Model, key)` leases a shared instance in the caller scope. When the
caller scope closes, the lease releases. When the last lease releases, the
model lifetime policy decides when the instance is disposed.

Defaults:

- singleton models are `keepAlive`
- keyed models idle out after 10 minutes
- `lifetime: { idleTimeToLive: "1 minute" }` changes the idle TTL
- `lifetime: "keepAlive"` pins a keyed model

Parent models own children they get in `make`. `Model.list` owns dynamic child
leases and disposes sole-owned removed children immediately. `Model.dispose`
force-closes an instance now, even with outstanding leases.

Inside `make`, Effect's ambient scope is the model instance scope. Use
`Effect.addFinalizer` for external resources.

```ts
const socket = yield* openSocket();

yield* Effect.addFinalizer(() =>
  socket.close.pipe(Effect.catchAll(() => Effect.void)),
);
```

Stores, events, queries, mutations, and `Registry.run` pipelines already
clean up with the owner scope.
