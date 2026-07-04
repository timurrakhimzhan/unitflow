import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { ModelRuntime, ModelRuntimeProvider } from "@unitflow/react";
import { CatalogApi, catalogApi } from "./catalog";
import { ProductSearchApp } from "./App";
import { ProductSearchModel } from "./model";
import "./styles.css";

const layer = ProductSearchModel.layer.pipe(
  Layer.provideMerge(Layer.succeed(CatalogApi, catalogApi)),
);
const runtime = ModelRuntime.make(layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ModelRuntimeProvider runtime={runtime}>
      <ProductSearchApp />
    </ModelRuntimeProvider>
  </React.StrictMode>,
);
