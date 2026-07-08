import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { devtools } from "@unitflow/devtools";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { Router } from "@unitflow/router";
import { App } from "./App";
import { AppModel } from "./model";
import { AppPages, AppRouter, AuthGuardLive } from "./routes";
import { SessionModel } from "./session";
import "./styles.css";

// Forget AuthGuardLive here and the layer no longer typechecks: the router
// requires the guard TAG, the guard requires the session.
const layer = AppModel.layer.pipe(
  Layer.provideMerge(AppPages.layer),
  Layer.provideMerge(AppRouter.layer),
  Layer.provideMerge(Router.browserHistoryLayer),
  Layer.provideMerge(AuthGuardLive),
  Layer.provideMerge(SessionModel.layer),
);
const runtime = UnitflowRuntime.make(layer);

if (import.meta.env.DEV) devtools(runtime, { app: "router-guard" });

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Unitflow runtime={runtime} rootModel={AppModel}>
      {(app) => <App unit={app} />}
    </Unitflow>
  </React.StrictMode>,
);
