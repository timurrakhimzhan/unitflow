---
name: unitflow-modeling
description: "Use when designing, implementing, reviewing, or testing Unitflow/effect-model UI state manager code: Effect Service models, Store/Event ports, Query/Mutation async flows, React View.make bindings, dynamic keyed model instances, scoped lifetime, Registry.allSettled tests, or migrations away from atom-based UI state."
---

# Unitflow Modeling

Use this skill to keep Unitflow code model-first. A model is the owner of one
piece of UI behavior. Stores hold state, events describe actions, queries and
mutations own visible async work, and Views only bind the model's `ui`.

## Workflow

1. Pick the model boundary: page, feature, widget, form, row, dialog, or
   headless service.
2. Put owned state, actions, async work, dependencies, children, and lifetime
   inside `Model.Service`.
3. Expose typed surfaces: `inputs` for outside actions, `outputs` for
   composition and tests, `ui` for rendering.
4. Bind React with `View.make(Model, ...)`; JSX reads only `ui`.
5. Test models directly: resolve with `Model.get`, drive public actions, wait
   with `Registry.allSettled`, assert public state.

## Core Rules

- Models are Effect services. Dependencies come from Effect DI or `Model.get`.
- Keep public ports semantic: `selected`, `submit`, `view`, `changed`, not
  `selectedEvent` or `viewStore`.
- `inputs` are write/control ports for parents, routes, persistence, and tests.
- `outputs` are read/stream ports for parents, tests, and observers.
- `ui` is the complete render surface; Views must not read `inputs`/`outputs`.
- Use `Event.handler` for "on this event, run this Effect".
- Use `Registry.run` for custom stream pipelines.
- Use `Query` for reads, `Mutation` for observable writes, and plain Effects
  for local one-shot operations.

## References

Read only what the task needs:

- `references/architecture.md` for model shape, ports, View rules, and lifetime.
- `references/testing.md` for deterministic test patterns.
- `references/examples.md` for compact model examples.
