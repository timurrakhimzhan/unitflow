import * as Effect from "effect/Effect";
import { Event, Model, Resource, Store } from "@unitflow/react";
import { type Category, CatalogApi } from "./catalog";

export class ProductSearchModel extends Model.Service<ProductSearchModel>()(
  "@unitflow/example/resource-search",
)({
  make: () =>
    Effect.gen(function* () {
      const query = Store.make("dashboard", { name: "query" });
      const category = Store.make<Category>("all", { name: "category" });

      const results = yield* Resource.make({
        stores: { query, category },
        handler: ({ query, category }) =>
          Effect.gen(function* () {
            const catalog = yield* CatalogApi;
            return yield* catalog.search({ query, category });
          }),
      });

      const view = Store.combine(
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
          view,
          setQuery: Event.setter(query, { name: "setQuery" }),
          setCategory: Event.setter(category, { name: "setCategory" }),
          reload: results.refresh,
        },
      };
    }),
}) {}
