import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { BoardApp } from "./App";
import { BoardModel, TaskModel } from "./model";
import "./styles.css";

const layer = BoardModel.layer.pipe(Layer.provideMerge(TaskModel.layer));
const runtime = UnitflowRuntime.make(layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={BoardModel}>
      {(app) => <BoardApp unit={app} />}
    </Unitflow>
  </React.StrictMode>,
);
