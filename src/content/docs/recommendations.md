---
title: Recommendations
description: Practical project and agent setup for Unitflow codebases.
---

Unitflow works best when the codebase gives both humans and agents a clear
shape to follow.

## Keep Source Repos Local

For agent-assisted development, keep important source code local and tell the
agent where it is. For Unitflow work, Effect source is more useful as a local
reference than as search results or memory.

```txt
repos/effect-smol     -> Effect source reference
repos/unitflow        -> Unitflow source reference
```

Put the paths in `AGENTS.md` and keep external reference repositories ignored
by git:

```md
## Reference Repositories

- Effect source is shallow-cloned at `repos/effect-smol`.
- Unitflow source is shallow-cloned at `repos/unitflow`.

Both directories are reference material and are ignored by git.
```

Then ask the agent to inspect local source before changing code that depends on
Effect or Unitflow internals.

## Use Feature Slices

Unitflow fits well with feature-sliced code because a model already owns one
piece of UI behavior. Keep the model and its View near each other.

```txt
src/features/search/
  model.ts       -> SearchModel, stores, events, queries, mutations
  view.tsx       -> SearchView = View.make(SearchModel, ...)
  service.ts     -> feature Effect services, if needed
  index.ts       -> public exports
```

Use one slice for a screen, panel, widget, row, dialog, or headless behavior
service. Put durable state and Effect workflows in `model.ts`; keep `view.tsx`
focused on rendering the model's `ui`.

When a feature grows, split it by ownership:

```txt
src/features/board/
  model.ts
  view.tsx
  task/
    model.ts
    view.tsx
```

The parent model owns the feature flow. Child models own repeated or focused
parts of the UI. Views pass child units down; they do not create model
instances themselves.
