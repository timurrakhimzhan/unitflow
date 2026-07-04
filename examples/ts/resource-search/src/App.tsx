import { type Category, type Product } from "./catalog";
import { ProductSearchModel } from "./model";
import { Resource, View } from "@unitflow/react";

const categories: ReadonlyArray<Category> = ["all", "hardware", "software", "services"];

const formatPrice = (value: number): string =>
  new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(value);

const Results = ({
  results,
}: {
  readonly results: Resource.AsyncResult<ReadonlyArray<Product>, unknown>;
}) => {
  if (results._tag === "Waiting") {
    return <div className="result-state">Loading</div>;
  }

  if (results._tag === "Failure") {
    return <div className="result-state error">Catalog unavailable</div>;
  }

  if (results.value.length === 0) {
    return <div className="result-state">No matches</div>;
  }

  return (
    <ul className="product-grid">
      {results.value.map((product) => (
        <li className="product-card" key={product.id}>
          <div>
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
  );
};

export const ProductSearchApp = View.make(ProductSearchModel, (unit) => (
  <main className="search-shell">
    <section className="search-toolbar" aria-label="Catalog filters">
      <label>
        <span>Search</span>
        <input
          value={unit.view.query}
          onChange={(event) => unit.setQuery(event.currentTarget.value)}
        />
      </label>

      <label>
        <span>Category</span>
        <select
          value={unit.view.category}
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

    <Results results={unit.view.results} />
  </main>
));
