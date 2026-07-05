import * as Effect from "effect/Effect";
import { Event, Model, Query, Store } from "@unitflow/react";
import { type Category, CatalogApi } from "./catalog";

export class ProductSearchModel extends Model.Service<ProductSearchModel>()(
  "@unitflow/example/query-search",
)({
  make: () =>
    Effect.gen(function* () {
      const query = Store.make("dashboard");
      const category = Store.make<Category>("all");

      const results = yield* Query.make({
        stores: { query, category },
        handler: ({ query, category }) =>
          Effect.gen(function* () {
            const catalog = yield* CatalogApi;
            return yield* catalog.search({ query, category });
          }),
      });

      const searchState = Store.combine(
        [query, category, results.state],
        (query, category, results) => ({
          query,
          category,
          results,
        }),
      );

      return {
        inputs: {},
        outputs: { results: results.state },
        ui: {
          searchState,
          setQuery: Event.setter(query),
          setCategory: Event.setter(category),
          reload: results.refresh,
        },
      };
    }),
}) {}
