import { type Category, type Product } from "./catalog";
import { ProductSearchModel } from "./model";
import { View } from "@unitflow/react";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useState } from "react";

const categories: ReadonlyArray<Category> = ["all", "hardware", "software", "services"];

const formatPrice = (value: number): string =>
  new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(value);

/**
 * Windowed rendering: the result set lives as plain data in one store — even
 * ten thousand rows are cheap there — and only the rows inside the scroll
 * viewport (plus a small overscan) get DOM nodes. Scroll position is
 * view-local ephemera, so it stays in React state, not in the model.
 */
const ROW_HEIGHT = 64;
const VIEWPORT_HEIGHT = 520;
const OVERSCAN = 6;

const VirtualResults = ({ products }: { readonly products: ReadonlyArray<Product> }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    products.length,
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN,
  );

  return (
    <>
      <div className="result-count">
        {products.length.toLocaleString("en")} matches, rendering rows {start + 1}–{end}
      </div>
      <div
        className="product-viewport"
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <ul className="product-list" style={{ height: products.length * ROW_HEIGHT }}>
          {products.slice(start, end).map((product, index) => (
            <li
              className="product-row"
              key={product.id}
              style={{ top: (start + index) * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <div className="product-title">
                <strong>{product.title}</strong>
                <span>{product.category}</span>
              </div>
              <div className="product-meta">
                <span>{formatPrice(product.price)}</span>
                <span>{product.stock} in stock</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};

const Results = ({
  results,
}: {
  readonly results: AsyncResult.AsyncResult<ReadonlyArray<Product>, unknown>;
}) => {
  const value = AsyncResult.value(results);
  if (Option.isNone(value)) {
    return AsyncResult.isFailure(results) ? (
      <div className="result-state error">Catalog unavailable</div>
    ) : (
      <div className="result-state">Loading</div>
    );
  }

  if (value.value.length === 0) {
    return <div className="result-state">No matches</div>;
  }

  return <VirtualResults products={value.value} />;
};

export const ProductSearchApp = View.make(ProductSearchModel, (unit) => (
  <main className="search-shell">
    <section className="search-toolbar" aria-label="Catalog filters">
      <label>
        <span>Search</span>
        <input
          value={unit.searchState.query}
          onChange={(event) => unit.setQuery(event.currentTarget.value)}
        />
      </label>

      <label>
        <span>Category</span>
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
      </label>

      <button type="button" onClick={() => unit.reload()}>
        Reload
      </button>
    </section>

    <Results results={unit.searchState.results} />
  </main>
));
