import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { devtools } from "@unitflow/devtools";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { Router } from "@unitflow/router";
import { usersApi, UsersApi } from "./api";
import { AppView } from "./App";
import { NavigationModel, RouteModel, UserPageModel, UsersPageModel } from "./routes";
import "./styles.css";

const layer = AppView.model.layer.pipe(
  Layer.provideMerge(UsersPageModel.layer),
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(RouteModel.layer),
  Layer.provideMerge(NavigationModel.layer),
  Layer.provideMerge(Router.browserHistoryLayer),
  Layer.provideMerge(Layer.succeed(UsersApi, usersApi)),
);
const runtime = UnitflowRuntime.make(layer);

if (import.meta.env.DEV) devtools(runtime, { app: "router-basic" });

globalThis.addEventListener("beforeunload", () => {
  void runtime.dispose();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* The view carries its own root model: it owns the router and every
        page model stitched into the views map. */}
    <Unitflow runtime={runtime} rootModel={AppView.model}>
      {(pages) => <AppView unit={pages} />}
    </Unitflow>
  </React.StrictMode>,
);
