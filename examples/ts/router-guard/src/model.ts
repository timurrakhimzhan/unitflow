import * as Effect from "effect/Effect";
import { Model } from "@unitflow/react";
import { AppPages } from "./routes";
import { SessionModel } from "./session";

/** The root: owns the pages unit (router inside) and the session —
 * `units` is the escape hatch for units that are not a route's page. */
export class AppModel extends Model.Service<AppModel>()(
  "@unitflow/example/router-guard/App",
)({
  make: () =>
    Effect.gen(function* () {
      const pages = yield* Model.get(AppPages);
      const session = yield* Model.get(SessionModel);
      return {
        inputs: {},
        outputs: {},
        ui: { pages, session },
      };
    }),
}) {}
