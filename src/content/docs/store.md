---
title: Stores
description: Model state with Store.make, Store.get, Store.set, derived values, and change actions.
---

A store is state owned by a model instance.

Use it for form fields, selected ids, counters, filters, derived render data, and
small pieces of domain state that should live with the model. A store is scoped
by the Unitflow registry: every app runtime or test registry gets its own
state.

## Create

```ts
import { Store } from "@unitflow/core";

const count = Store.make(0);

const draft = Store.make({
  name: "",
  description: "",
});
```

The initial value belongs to the store declaration. A fresh registry starts
from that value.

## Read

Read the current value inside an Effect with `Store.get`.

```ts
const current = yield* Store.get(count);
```

## Write

Use `Store.set` when the next value is known.

```ts
yield* Store.set(count, 1);
```

Use `Store.update` when the next value depends on the current value.

```ts
yield* Store.update(count, (value) => value + 1);
```

Reset one or more stores to their declared initial values.

```ts
yield* Store.reset(count, draft);
```

In normal model code, writes happen inside event handlers, queries, mutations,
or other Effects owned by the model.

## Derive

Use `.pipe(Store.map(...))` for one store.

```ts
const count = Store.make(0);

const isEven = count.pipe(Store.map((value) => value % 2 === 0));
```

Use `Store.combine` when a value depends on several stores.

```ts
const firstName = Store.make("");
const lastName = Store.make("");

const fullName = Store.combine(
  [firstName, lastName],
  (firstName, lastName) => `${firstName} ${lastName}`.trim(),
);
```

Derived stores are read-only. Write to the original stores.

## UI Setters

`Event.setter(store)` creates a model action that writes a store. It is useful
for input fields where the UI sends the next value directly.

```tsx
import { Event, Store } from "@unitflow/core";
import { useEvent, useStore } from "@unitflow/react";

const input = Store.make("");
const setInput = Event.setter(input);

function TextInput() {
  const value = useStore(input);
  const onChange = useEvent(setInput);

  return (
    <input
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}
```

## React to Changes

Use `Store.changed(store)` when a later store change should trigger model
logic. It creates an event that skips the current value and emits only future
changes.

```ts
import * as Effect from "effect/Effect";
import { Event, Store } from "@unitflow/core";

const query = Store.make("");

// Store.changed converts a Store into an Event of future changes.
yield* query.pipe(
  Store.changed,
  Event.handler((value) =>
    Effect.log(`query changed to ${value}`),
  ),
);
```

This is the simple way to subscribe to store changes inside a model. Reach for
raw `Store.stream(...)` only when you need stream operators such as debounce,
merge, throttle, or schedules.

## Forward Into Another Store

A child MODEL that needs a parent's live value is not a forwarding target —
key the child directly by the store reference instead (see
[Keying On a Live Store](./model.mdx#keying-on-a-live-store)): the child
reads the SAME store, no copy, no separate port to keep in sync, no race
between construction and the first forwarded value.

`Store.forwardTo(input)` stays useful for keeping two stores YOU already own
in sync — e.g. mirroring a persisted store into the plain one a view reads
from, without hand-rolling `Store.stream(...).pipe(Stream.mapEffect(...))`:

```ts
import { Store } from "@unitflow/core";

const persisted = Store.make<LanguageFilter>("all").pipe(
  Store.persist({ key: "language", schema: LanguageSchema }),
);
const active = Store.make<LanguageFilter>("all");

yield* persisted.pipe(Store.forwardTo(active));
```

It is pipeable and data-last, and forks into the enclosing model's scope like
`Registry.run` — set it up once during `make`, it runs for the model's whole
lifetime.

`Event.forwardTo(input)` is the event-shaped twin, still commonly aimed at a
child's own `Event.input()` port — an action has no live value to key a
model on, so forwarding stays the right tool there. See
[Forward Into Another Event](./events.md#forward-into-another-event).

## Awaiting Store Values

Use `Store.waitFor(store, predicate)` when an Effect needs to block until a
store reaches a matching value.

```ts
const ready = yield* Store.waitFor(status, (value) => value === "ready");
```

## Persistence

Use `Store.persist(...)` to keep a store's value in a `KeyValueStore` across
sessions — filters, drafts, UI preferences.

```ts
import * as Schema from "effect/Schema";

type LanguageFilter = "all" | "TypeScript" | "Rust";
const LanguageSchema = Schema.Literals(["all", "TypeScript", "Rust"]);

const language = yield* Store.make<LanguageFilter>("all").pipe(
  Store.persist({ key: "language", schema: LanguageSchema }),
);
```

Match the schema to the store's exact type: for a literal-union store use
`Schema.Literals(...)`, not `Schema.String`. A wider schema compiles (stores
are covariant), but it would happily hydrate any stored string into a store
whose type promises a literal union — the schema is the only runtime guard.

Hydration is inline: by the time `persist` returns, the store already holds
the restored value, so anything built on it afterwards — a dependent query, a
combined store — sees the restored value from its first run. Every later
change is saved with a timestamp; an entry that fails to decode or outlives
`timeToLive` is a miss, leaving the initial value in place. Persistence is
best-effort: storage and codec errors are logged as warnings and never affect
the store itself.

The requirements gain `KeyValueStore` — the same layers as
[Query persistence](./queries.md#persistence): `layerStorage(() =>
localStorage)` in the browser, `layerMemory` in tests.

How a model exposes stores and events is covered in [Model](./model.mdx).
