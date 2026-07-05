import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { CatalogApi, catalogApi } from "./catalog";
import { ProductSearchApp } from "./App";
import { ProductSearchModel } from "./model";
import "./styles.css";

const layer = ProductSearchModel.layer.pipe(
  Layer.provideMerge(Layer.succeed(CatalogApi, catalogApi)),
);
const runtime = UnitflowRuntime.make(layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={ProductSearchModel}>
      {(app) => <ProductSearchApp unit={app} />}
    </Unitflow>
  </React.StrictMode>,
);
