import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { ModelRuntime, ModelRuntimeProvider } from "@unitflow/react";
import { BoardApp } from "./App";
import { BoardModel, TaskModel } from "./model";
import "./styles.css";

const layer = BoardModel.layer.pipe(Layer.provideMerge(TaskModel.layer));
const runtime = ModelRuntime.make(layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ModelRuntimeProvider runtime={runtime}>
      <BoardApp />
    </ModelRuntimeProvider>
  </React.StrictMode>,
);
