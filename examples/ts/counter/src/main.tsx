import * as React from "react";
import { createRoot } from "react-dom/client";
import { ModelRuntime, ModelRuntimeProvider } from "@unitflow/react";
import { CounterApp } from "./App";
import { CounterModel } from "./model";
import "./styles.css";

const runtime = ModelRuntime.make(CounterModel.layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ModelRuntimeProvider runtime={runtime}>
      <CounterApp />
    </ModelRuntimeProvider>
  </React.StrictMode>,
);
