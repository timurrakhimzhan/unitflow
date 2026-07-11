import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Event, Model, Query, Store } from "@unitflow/react";
import { DirectoryApi, type LanguageFilter } from "./directory";

/**
 * One instance per repo whose popover was opened at least once. The table
 * model owns these children; a closed popover's instance stays leased, so
 * re-hovering shows the already loaded pages instantly.
 */
export class ContributorsModel extends Model.Service<ContributorsModel>()(
  "@unitflow/example/paginated-table/contributors",
)<{ readonly repoId: string }>()({
  make: ({ repoId }) =>
    Effect.gen(function* () {
      // Offset-style pagination: the cursor type is inferred from the anchor.
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

export class RepoTableModel extends Model.Service<RepoTableModel>()(
  "@unitflow/example/paginated-table/table",
)({
  make: () =>
    Effect.gen(function* () {
      const language = Store.make<LanguageFilter>("all");

      // Changing `language` resets to the first page; `loadMore` appends.
      // The backend pages with an opaque token: `null` asks for the first page.
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

      // The table owns the popover children and materializes them lazily on
      // first hover: `push` is idempotent, an existing key is a no-op. Which
      // popover is VISIBLE stays presentation state in React — the model only
      // decides which instances exist.
      const contributorPanels = yield* Model.list(ContributorsModel);
      const openContributors = yield* Event.make<string>().pipe(
        Event.handler((repoId) => Effect.asVoid(contributorPanels.push({ repoId }))),
      );

      return {
        inputs: { refresh: Event.toInput(rows.refresh) },
        outputs: { rows: rows.state },
        ui: {
          rows: rows.state,
          hasMore: rows.hasMore,
          loadMore: rows.loadMore,
          refresh: rows.refresh,
          language,
          setLanguage: Event.setter(language),
          openContributors,
          contributorPanels: contributorPanels.items,
        },
      };
    }),
}) {}
