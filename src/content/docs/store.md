---
title: Store
description: Scoped state sources, derived stores, updates, and resets.
---

A Store is scoped state owned by a registry. It is not a global singleton and it
is not React state.

Use stores for values that should be read by UI, composed by other stores, or
observed by model logic.

## Create

```ts
const open = Store.make(false);

const draft = Store.make<ProjectDraft>({
  name: "",
  description: "",
});
```

The initial value belongs to the store definition. Every registry gets its own
copy of the state.

## Combine

Derived state should be a store too. Do not recompute view state in React.

```ts
const canSave = Store.combine(
  [draft, saving],
  (draft, saving) => draft.name.trim().length > 0 && !saving,
);

const view = Store.combine([open, draft, canSave], (open, draft, canSave) => ({
  open,
  draft,
  canSave,
}));
```

Combined stores are read-only derived sources. Write to the source stores, not
to the combined store.

## Set And Update

Set when the next value is already known.

```ts
yield* Store.set(open, true);
```

Update when the next value depends on the current value.

```ts
yield* Store.update(draft, (current) => ({
  ...current,
  name: current.name.trim(),
}));
```

For UI binding, expose event sinks instead of exposing store write operations
directly.

```ts
const setOpen = Event.setter(open);

const rename = yield* Event.make<string>().pipe(
  Event.handler((name) =>
    Store.update(draft, (current) => ({
      ...current,
      name,
    })),
  ),
);
```

## Reset

Reset should be a first-class store operation: return the store to its initial
value without duplicating that value in handlers.

```ts
yield* Store.reset(draft);
```

If `Store.reset` is not implemented yet, it should be added as a primitive. A
reset is conceptually different from `Store.set(draft, initialDraft)` because
the initial value belongs to the store.

## Public Ports

Expose stores by capability:

```ts
return {
  inputs: {
    rename,
  },
  outputs: {
    draft,
    canSave,
  },
  ui: {
    view,
    setOpen,
    rename,
  },
};
```

Other models can read `outputs`. Views receive `ui` stores as current values and
event sinks as callbacks.
