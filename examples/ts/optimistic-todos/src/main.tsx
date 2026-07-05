import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { TodosApp } from "./App";
import { TodosModel } from "./model";
import { TodosApi, todosApi } from "./todos-api";
import "./styles.css";

const layer = TodosModel.layer.pipe(
  Layer.provideMerge(Layer.succeed(TodosApi, todosApi)),
);
const runtime = UnitflowRuntime.make(layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={TodosModel}>
      {(app) => <TodosApp unit={app} />}
    </Unitflow>
  </React.StrictMode>,
);
