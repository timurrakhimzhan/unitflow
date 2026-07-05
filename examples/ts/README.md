# Unitflow TypeScript Examples

Runnable examples live here as small private workspace packages. This mirrors
the pattern used by state-manager repositories such as Zustand, Jotai, XState,
MobX, TanStack Store, and Redux Toolkit: each scenario is a real app with its
own `package.json`, `tsconfig.json`, Vite entry, and focused source tree.

## Examples

```txt
counter/           Store + Event ports, derived UI state, React View binding
query-search/      Query-driven async search with an injected Effect service
kanban-board/      Keyed child models, Model.list, nested Views, list disposal
paginated-table/   Paginated Query table with a nested paginated hover popover
optimistic-todos/  Optimistic updates with rollback from plain Store + Mutation
```

## Commands

```bash
pnpm examples:build
pnpm --filter @unitflow/example-counter dev
pnpm --filter @unitflow/example-query-search dev
pnpm --filter @unitflow/example-kanban-board dev
pnpm --filter @unitflow/example-paginated-table dev
pnpm --filter @unitflow/example-optimistic-todos dev
```

The apps resolve `@unitflow/*` to `packages/*/src` in dev, so they can be used
while editing the library without a package build first.
