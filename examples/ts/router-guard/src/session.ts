import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Event, Model, Store } from "@unitflow/react";

/** Client-side session: who is logged in, if anyone. */
export class SessionModel extends Model.Service<SessionModel>()(
  "@unitflow/example/router-guard/Session",
)({
  make: () =>
    Effect.gen(function* () {
      const user = Store.make<Option.Option<string>>(Option.none());

      const login = yield* Event.input<string>({ name: "session.login" }).pipe(
        Event.handler((name) => Store.set(user, Option.some(name))),
      );
      const logout = yield* Event.input({ name: "session.logout" }).pipe(
        Event.handler(() => Store.set(user, Option.none())),
      );

      return {
        inputs: { login, logout },
        outputs: { user },
        ui: { user, login, logout },
      };
    }),
}) {}
