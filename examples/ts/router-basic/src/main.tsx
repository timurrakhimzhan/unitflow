import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { devtools } from "@unitflow/devtools";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { usersApi, UsersApi } from "./api";
import { App } from "./App";
import { AppModel, UserPageModel, UsersPageModel } from "./model";
import { AppRouter } from "./routes";
import "./styles.css";

const layer = AppModel.layer.pipe(
  Layer.provideMerge(UsersPageModel.layer),
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(AppRouter.layer),
  Layer.provideMerge(Layer.succeed(UsersApi, usersApi)),
);
const runtime = UnitflowRuntime.make(layer);

if (import.meta.env.DEV) devtools(runtime, { app: "router-basic" });

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
