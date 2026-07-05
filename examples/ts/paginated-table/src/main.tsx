import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { RepoTableApp } from "./App";
import { ContributorsModel, RepoTableModel } from "./model";
import { DirectoryApi, directoryApi } from "./directory";
import "./styles.css";

const layer = RepoTableModel.layer.pipe(
  Layer.provideMerge(ContributorsModel.layer),
  Layer.provideMerge(Layer.succeed(DirectoryApi, directoryApi)),
);
const runtime = UnitflowRuntime.make(layer);

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={RepoTableModel}>
      {(app) => <RepoTableApp unit={app} />}
    </Unitflow>
  </React.StrictMode>,
);
