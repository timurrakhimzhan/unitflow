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

      // Both query ports reach the view: `results` says what the read is
      // doing right now, `loaded` is the last catalog the endpoint returned.
      // While a keystroke changes the dependencies, `results` is Initial and
      // `loaded` still holds the previous matches — which is what keeps the
      // list from blanking on every letter.
      const searchState = Store.combine(
        [query, category, results.state, results.data],
        (query, category, results, loaded) => ({
          query,
          category,
          results,
          loaded,
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
