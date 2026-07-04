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
        name: "catalogResults",
        stores: { query, category },
        handler: ({ query, category }) =>
          Effect.gen(function* () {
            const catalog = yield* CatalogApi;
            return yield* catalog.search({ query, category });
          }),
      }).pipe(Resource.debounce("250 millis"));


      const view = Store.combine(
        [query, category, results],
        (query, category, results) => ({
          query,
          category,
          results,
        }),
      );

      return {
        inputs: {},
        outputs: { results },
        ui: {
          view,
          setQuery: Event.setter(query, { name: "setQuery" }),
          setCategory: Event.setter(category, { name: "setCategory" }),
          reload: results.reload,
        },
      };
    }),
}) {}
