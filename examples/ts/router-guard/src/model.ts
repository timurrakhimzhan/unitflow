import * as Effect from "effect/Effect";
import { Model } from "@unitflow/react";
import { AppRouter } from "./routes";
import { SessionModel } from "./session";

/** The root: owns the router and the session, republishing both through
 * `ui` for the view tree. */
export class AppModel extends Model.Service<AppModel>()(
  "@unitflow/example/router-guard/App",
)({
  make: () =>
    Effect.gen(function* () {
      const router = yield* Model.get(AppRouter);
      const session = yield* Model.get(SessionModel);
      return {
        inputs: {},
        outputs: {},
        ui: { router, session },
      };
    }),
}) {}
