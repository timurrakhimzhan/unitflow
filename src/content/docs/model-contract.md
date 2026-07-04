---
title: Model Contract
description: The inputs, outputs, and ui surfaces every Unitflow model returns.
---

Every model returns the same three surfaces:

```ts
{
  inputs: Record<string, SinkPort>;
  outputs: Record<string, SourcePort>;
  ui: Record<string, SourcePort | Event.Sink<any> | UnitPorts>;
}
```

## inputs

Use `inputs` for commands and external writes from parents, routes, persistence,
or tests.

```ts
inputs: {
  fill,
  submit,
}
```

Outside code can emit/set inputs but cannot read them.

## outputs

Use `outputs` for events and stores that other models may compose.

```ts
outputs: {
  selected,
  value,
}
```

Outside code can get/stream outputs but cannot write them.

## ui

Use `ui` for the View's complete render surface.

```ts
ui: {
  view,
  setOpen,
  projectPicker,
}
```

Stores arrive in a React View as values. Event sinks arrive as callbacks. Nested
unit ports are passed to child Views through `unit`.

## Naming

Port names should describe domain intent, not implementation:

```ts
setPrompt
selected
view
changed
```

Avoid suffixes such as `Atom`, `Store`, or `Event` in public port names. The
type already carries that information.
