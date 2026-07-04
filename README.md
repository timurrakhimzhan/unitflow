# Unitflow

Unitflow is an Effect-native UI state manager: scoped model instances,
typed ports, stream-first orchestration, and React views that only bind model
`ui`.

This repository contains publishable runtime packages and the Astro Starlight
documentation site.

## Commands

```bash
pnpm dev
pnpm docs:dev
pnpm packages:build
pnpm packages:test
pnpm docs:check
pnpm skill:validate
pnpm check
```

`dev` / `docs:dev` serves the Starlight docs site at `http://localhost:4177`.

## Shape

```txt
docs/                         Source design notes kept as plain Markdown
packages/core/                @unitflow/core runtime package
packages/react/               @unitflow/react binding package
src/content/docs/             Starlight documentation pages
skills/unitflow-modeling/     Codex skill for writing Unitflow code
scripts/                      Local validation helpers
```

## Packages

The npm package split:

```txt
@unitflow/core    Model, Store, Event, Registry, ModelRuntime
@unitflow/react   React binding, View.make, provider, hooks
```

`@unitflow/react` depends on `@unitflow/core` and re-exports the common core API
for React users. `effect` and `react` stay peer dependencies.
