---
title: Query Search
description: A catalog search example with Query, an injected API service, and AsyncResult UI state.
---

This example keeps async read state in a model. The View sends search input
events and renders the query result.

Runnable app: `examples/ts/query-search`.

## API Service

```ts
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
  readonly search: (
    input: SearchInput,
  ) => Effect.Effect<ReadonlyArray<Product>, unknown>;
}

export class CatalogApi extends Context.Service<
  CatalogApi,
  CatalogApiShape
>()("@unitflow/example/query-search/CatalogApi") {}
```

## Model

```ts
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
```

## View

```tsx
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { View } from "@unitflow/react";
import { type Category, type Product } from "./catalog";
import { ProductSearchModel } from "./model";

const categories: ReadonlyArray<Category> = [
  "all",
  "hardware",
  "software",
  "services",
];

const Results = ({
  results,
}: {
  readonly results: AsyncResult.AsyncResult<ReadonlyArray<Product>, unknown>;
}) =>
  AsyncResult.builder(results)
    .onWaiting(() => <div>Loading</div>)
    .onFailure(() => <div>Catalog unavailable</div>)
    .onSuccess((products) =>
      products.length === 0 ? (
        <div>No matches</div>
      ) : (
        <ul>
          {products.map((product) => (
            <li key={product.id}>{product.title}</li>
          ))}
        </ul>
      ),
    )
    .orNull();

export const ProductSearchApp = View.make(ProductSearchModel, (unit) => (
  <main>
    <input
      value={unit.searchState.query}
      onChange={(event) => unit.setQuery(event.currentTarget.value)}
    />

    <select
      value={unit.searchState.category}
      onChange={(event) => unit.setCategory(event.currentTarget.value as Category)}
    >
      {categories.map((category) => (
        <option key={category} value={category}>
          {category}
        </option>
      ))}
    </select>

    <button type="button" onClick={() => unit.reload()}>
      Reload
    </button>

    <Results results={unit.searchState.results} />
  </main>
));
```

## Runtime

```tsx
import * as Layer from "effect/Layer";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { CatalogApi, catalogApi } from "./catalog";
import { ProductSearchApp } from "./App";
import { ProductSearchModel } from "./model";

const layer = ProductSearchModel.layer.pipe(
  Layer.provideMerge(Layer.succeed(CatalogApi, catalogApi)),
);
const runtime = UnitflowRuntime.make(layer);

<Unitflow runtime={runtime} rootModel={ProductSearchModel}>
  {(app) => <ProductSearchApp unit={app} />}
</Unitflow>;
```
