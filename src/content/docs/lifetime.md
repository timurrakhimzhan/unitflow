---
title: Lifetime and Ownership
description: Scoped ownership for root models, parent models, and dynamic children.
---

The intended model is scoped ownership, not raw React mount ownership.

```txt
parent model gets child model
  -> parent owns a reference
parent scope closes
  -> ownership is released
last owner disappears
  -> child scope closes
```

React Views can be root owners, but parent models should own child model
dependencies.

## Target Shape

The registry can be implemented as an RCMap-like structure:

```txt
InstanceKey -> scoped instance + owner references
```

`Model.get(ChildModel, key)` should:

1. Resolve or construct the instance.
2. Attach ownership to the current `InstanceScope`.
3. Release ownership automatically when that scope closes.

This keeps the public API small:

```ts
const picker = yield* Model.get(ProjectPickerModel, pickerKey);
```

No manual `acquire` / `release` in application models.
