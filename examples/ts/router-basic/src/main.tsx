import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Layer from "effect/Layer";
import { devtools } from "@unitflow/devtools";
import { Unitflow, UnitflowRuntime } from "@unitflow/react";
import { Router } from "@unitflow/router";
import { usersApi, UsersApi } from "./api";
import { Outlet } from "./App";
import { AppPages, AppRouter, UserPageModel, UsersPageModel } from "./routes";
import "./styles.css";

const layer = AppPages.layer.pipe(
  Layer.provideMerge(UsersPageModel.layer),
  Layer.provideMerge(UserPageModel.layer),
  Layer.provideMerge(AppRouter.layer),
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
    {/* The root IS the pages model: it owns the router and every mapped
        page model — no hand-written AppModel. */}
    <Unitflow runtime={runtime} rootModel={AppPages}>
      {(pages) => <Outlet unit={pages} />}
    </Unitflow>
  </React.StrictMode>,
);
