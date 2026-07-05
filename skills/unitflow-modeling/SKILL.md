---
name: unitflow-modeling
description: "Use when designing, implementing, reviewing, or testing Unitflow/effect-model UI state manager code: Effect Service models, Store/Event ports, Query/Mutation async flows, React View.make bindings, dynamic keyed model instances, scoped lifetime, Registry.allSettled tests, or migrations away from atom-based UI state."
---

# Unitflow Modeling

Use this skill to keep Unitflow code in the intended architecture: models own
logic, Views bind `ui`, parents compose `inputs`/`outputs`, and tests drive
ports through a fresh registry.

## Workflow

1. Identify the unit boundary: feature, widget, page, entity, or dynamic child.
2. Put all state and effects in `Model.Service`.
3. Return the port surfaces: `inputs`, `outputs`, and — for models a View
   renders — `ui`. Headless service models omit `ui`; `View.make` rejects
   them at the type level.
4. Bind React through `View.make(Model, ...)`.
5. Test with `Model.get`, `Event.emit`, `Store.get`, and `Registry.allSettled`.

## Core Rules

- Use Effect services for models. Dependencies come from Effect DI or
  `Model.get`, never ad-hoc dependency objects.
- Keep public ports semantic: `selected`, `submit`, `view`, `changed`, not
  `selectedEvent` or `viewStore`.
- `inputs` are external write/control ports.
- `outputs` are read/stream ports for parent models and tests.
- `ui` is the complete render surface; JSX must not read `inputs`/`outputs`.
- Use `Event.handler` for "on this event, run this Effect".
- Use `Registry.run` for custom stream pipelines.
- Use `Query` for reads, `Mutation` for observable writes, and plain Effects
  for local one-shot operations.
- In tests, never manually mount ports and never use generic `flush` helpers.

## References

Read only what the task needs:

- `references/architecture.md` for model shape, ports, View rules, and lifetime.
- `references/testing.md` for deterministic test patterns.
- `references/examples.md` for compact model examples.
