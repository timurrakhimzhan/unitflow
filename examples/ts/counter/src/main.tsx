import * as React from "react";
import { createRoot } from "react-dom/client";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { CounterApp } from "./App";
import { CounterModel } from "./model";
import "./styles.css";

const runtime = UnitflowRuntime.make(CounterModel.layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={CounterModel}>
      {(app) => <CounterApp unit={app} />}
    </Unitflow>
  </React.StrictMode>,
);
