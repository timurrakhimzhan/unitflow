import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type Category = "all" | "hardware" | "software" | "services";

export interface Product {
  readonly id: string;
  readonly title: string;
  readonly category: Exclude<Category, "all">;
  readonly price: number;
  readonly stock: number;
}

export interface SearchInput {
  readonly query: string;
  readonly category: Category;
}

export interface CatalogApiShape {
  readonly search: (input: SearchInput) => Effect.Effect<ReadonlyArray<Product>, unknown>;
}

export class CatalogApi extends Context.Service<CatalogApi, CatalogApiShape>()(
  "@unitflow/example/resource-search/CatalogApi",
) {}

const products: ReadonlyArray<Product> = [
  { id: "sku-101", title: "Edge gateway", category: "hardware", price: 229, stock: 18 },
  { id: "sku-102", title: "Telemetry probe", category: "hardware", price: 84, stock: 42 },
  { id: "sku-201", title: "Ops dashboard", category: "software", price: 49, stock: 999 },
  { id: "sku-202", title: "Audit trail", category: "software", price: 29, stock: 999 },
  { id: "sku-301", title: "Migration plan", category: "services", price: 600, stock: 7 },
  { id: "sku-302", title: "Incident review", category: "services", price: 340, stock: 12 },
];

export const catalogApi = CatalogApi.of({
  search: ({ category, query }) =>
    Effect.gen(function* () {
      yield* Effect.sleep("320 millis");

      const normalized = query.trim().toLowerCase();
      if (normalized === "fail") {
        return yield* Effect.fail("The catalog endpoint rejected this query.");
      }

      return products.filter((product) => {
        const inCategory = category === "all" || product.category === category;
        const inQuery = normalized === "" || product.title.toLowerCase().includes(normalized);
        return inCategory && inQuery;
      });
    }),
});
