import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface User {
  readonly id: number;
  readonly name: string;
  readonly role: string;
  readonly bio: string;
}

export interface UsersApiShape {
  readonly list: () => Effect.Effect<ReadonlyArray<User>>;
  readonly get: (id: number) => Effect.Effect<User, "not found">;
}

export class UsersApi extends Context.Service<UsersApi, UsersApiShape>()(
  "@unitflow/example/router-basic/UsersApi",
) {}

const users: ReadonlyArray<User> = [
  { id: 1, name: "Ada Lovelace", role: "Analyst", bio: "Wrote the first published algorithm." },
  { id: 2, name: "Grace Hopper", role: "Rear Admiral", bio: "Built the first compiler." },
  { id: 3, name: "Barbara Liskov", role: "Professor", bio: "Substitution principle, CLU, Argus." },
  { id: 4, name: "Anita Borg", role: "Researcher", bio: "Founded the Institute for Women and Technology." },
];

/** In-memory backend with a small delay so pending states are visible. */
export const usersApi: UsersApiShape = {
  list: () => Effect.sleep("400 millis").pipe(Effect.as(users)),
  get: (id) =>
    Effect.sleep("400 millis").pipe(
      Effect.flatMap(() => {
        const user = users.find((current) => current.id === id);
        return user === undefined ? Effect.fail("not found" as const) : Effect.succeed(user);
      }),
    ),
};
