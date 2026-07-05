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
  "@unitflow/example/query-search/CatalogApi",
) {}

/**
 * A deliberately large catalog: 10,000 rows demonstrate that a big collection
 * is just DATA in one store — the UI windows the rendering (see `App.tsx`),
 * and no per-row model instances are constructed for it.
 */
const CATALOG_SIZE = 10_000;

const titleWords = {
  hardware: ["Edge gateway", "Telemetry probe", "Rack sensor", "Field relay", "Mesh antenna"],
  software: ["Ops dashboard", "Audit trail", "Sync engine", "Metrics hub", "Alert router"],
  services: ["Migration plan", "Incident review", "Capacity audit", "Onboarding", "Recovery drill"],
} as const;

const generatedCategories = ["hardware", "software", "services"] as const;

/** Deterministic PRNG, so every reload shows the same catalog. */
const mulberry32 = (seed: number) => (): number => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const random = mulberry32(20260705);

const products: ReadonlyArray<Product> = Array.from({ length: CATALOG_SIZE }, (_, index) => {
  const category = generatedCategories[index % generatedCategories.length];
  const words = titleWords[category];
  const word = words[Math.floor(random() * words.length)];
  return {
    id: `sku-${1000 + index}`,
    title: `${word} ${1000 + index}`,
    category,
    price: Math.round(20 + random() * 980),
    stock: Math.round(random() * 999),
  };
});

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
