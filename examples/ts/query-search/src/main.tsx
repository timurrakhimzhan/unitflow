import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { devtools } from "@unitflow/devtools";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { CatalogApi, catalogApi } from "./catalog";
import { ProductSearchApp } from "./App";
import { ProductSearchModel } from "./model";
import "./styles.css";

const layer = ProductSearchModel.layer.pipe(
  Layer.provideMerge(Layer.succeed(CatalogApi, catalogApi)),
);
const runtime = UnitflowRuntime.make(layer);

// Run `npx unitflow-mcp` next to the dev server and every model, store
// write, and event becomes visible to the agent.
if (import.meta.env.DEV) devtools(runtime, { app: "query-search" });

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
