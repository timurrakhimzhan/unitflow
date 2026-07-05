---
title: Paginated Table
description: An infinite-query table where one cell opens a popover with its own infinite query.
---

A paginated table of repositories with a nested pagination: hovering the
contributors cell opens a popover whose list is its own infinite query with
scroll-to-load-more. Nested pagination is composition, not an API feature —
the inner list is a keyed child model, one instance per row.

Runnable app: `examples/ts/paginated-table`.

## Models

The table is a singleton model with a token-cursor infinite query; changing
the `language` dependency resets it to the first page.

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Event, Model, Query, Store } from "@unitflow/react";
import { DirectoryApi, type LanguageFilter } from "./directory";

export class RepoTableModel extends Model.Service<RepoTableModel>()(
  "@unitflow/example/paginated-table/table",
)({
  make: () =>
    Effect.gen(function* () {
      const language = Store.make<LanguageFilter>("all");

      const rows = yield* Query.makeInfinite({
        stores: { language },
        initialCursor: null as string | null,
        handler: ({ language }, cursor) =>
          Effect.gen(function* () {
            const api = yield* DirectoryApi;
            const page = yield* api.repos({ language, cursor });
            return { data: page.items, next: Option.fromNullishOr(page.next) };
          }),
      });

      return {
        inputs: { refresh: rows.refresh },
        outputs: { rows: rows.state },
        ui: {
          rows: rows.state,
          hasMore: rows.hasMore,
          loadMore: rows.loadMore,
          refresh: rows.refresh,
          language,
          setLanguage: Event.setter(language),
        },
      };
    }),
}) {}
```

Each row's popover content is a keyed model with an offset-cursor infinite
query. The table model owns these children through `Model.list` and
materializes them lazily on first hover — `push` is idempotent, an existing
key is a no-op. A closed popover's instance stays leased, so re-hovering
shows the already loaded pages instantly.

```ts
// внутри make таблицы
const contributorPanels = yield* Model.list(ContributorsModel);
const openContributors = yield* Event.make<string>().pipe(
  Event.handler((repoId) => Effect.asVoid(contributorPanels.push({ repoId }))),
);
// ui: { ..., openContributors, contributorPanels: contributorPanels.items }
```

```ts
export class ContributorsModel extends Model.Service<ContributorsModel>()(
  "@unitflow/example/paginated-table/contributors",
)<{ readonly repoId: string }>()({
  make: ({ repoId }) =>
    Effect.gen(function* () {
      const contributors = yield* Query.makeInfinite({
        initialCursor: 0,
        handler: (_deps, skip) =>
          Effect.gen(function* () {
            const api = yield* DirectoryApi;
            const page = yield* api.contributors({ repoId, skip });
            return { data: page.items, next: Option.fromNullishOr(page.next) };
          }),
      });

      return {
        inputs: {},
        outputs: { contributors: contributors.state },
        ui: {
          contributors: contributors.state,
          hasMore: contributors.hasMore,
          loadMore: contributors.loadMore,
        },
      };
    }),
}) {}
```

## Popover View

The split of responsibilities: which instances EXIST is the model's decision
(the `openContributors` event), which popover is VISIBLE is presentation
state in React. The open delay keeps a mouse sweep across rows from
materializing a unit per row.

```tsx
const HoverPopover = ({ label, onOpen, children }: { ... }) => {
  const [open, setOpen] = React.useState(false);
  const openTimer = React.useRef<number | undefined>(undefined);

  const show = () => {
    setOpen(true);
    onOpen();                       // модель материализует юнит
  };
  const openSoon = () => {
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(show, 150);
  };
  const close = () => {
    window.clearTimeout(openTimer.current);
    setOpen(false);
  };

  return (
    <span className="popover-anchor" onMouseEnter={openSoon} onMouseLeave={close}>
      <button type="button" aria-expanded={open}>{label}</button>
      {open ? <div className="popover">{children}</div> : null}
    </span>
  );
};
```

Infinite scroll needs no debouncing: `loadMore` is a guarded no-op while
loading or exhausted, so the scroll handler just fires it near the bottom.

```tsx
const ContributorsPanel = View.make(ContributorsModel, (unit) => {
  const loaded = AsyncResult.value(unit.contributors);
  if (Option.isNone(loaded)) return <div>Loading contributors…</div>;

  return (
    <div
      className="popover-scroll"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) unit.loadMore();
      }}
    >
      <ul>
        {loaded.value.map((contributor) => (
          <li key={contributor.id}>{contributor.name}</li>
        ))}
      </ul>
      {unit.contributors.waiting ? <div>Loading more…</div> : null}
    </div>
  );
});
```

The table View looks the unit up in the units the model already owns and
hands it down — a View can never summon an instance itself:

```tsx
const panelByRepo = new Map(
  unit.contributorPanels.map((panel) => [panel.key.repoId, panel]),
);

<HoverPopover
  label={`${repo.contributorsTotal} contributors`}
  onOpen={() => unit.openContributors(repo.id)}
>
  {panel === undefined ? (
    <div className="popover-status">Loading contributors…</div>
  ) : (
    <ContributorsPanel unit={panel} />
  )}
</HoverPopover>
```

Because materializing a popover is a model event, the whole flow — open,
first page, scroll, load more — is testable headlessly with
`Registry.allSettled`, no browser required. The children die with the table
model that owns them.
