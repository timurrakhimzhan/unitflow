import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type Language = "TypeScript" | "Rust" | "Go" | "Python";
export type LanguageFilter = "all" | Language;

export interface Repo {
  readonly id: string;
  readonly name: string;
  readonly language: Language;
  readonly stars: number;
  readonly contributorsTotal: number;
}

export interface Contributor {
  readonly id: string;
  readonly name: string;
  readonly commits: number;
}

/** The repos endpoint pages with an opaque token (`null` = first page), the
 * contributors endpoint with a plain offset — two cursor styles the same
 * `Query.makeInfinite` handler shape absorbs. */
export interface DirectoryApiShape {
  readonly repos: (input: {
    readonly language: LanguageFilter;
    readonly cursor: string | null;
  }) => Effect.Effect<{ readonly items: ReadonlyArray<Repo>; readonly next?: string }, never>;
  readonly contributors: (input: {
    readonly repoId: string;
    readonly skip: number;
  }) => Effect.Effect<
    { readonly items: ReadonlyArray<Contributor>; readonly next?: number },
    never
  >;
}

export class DirectoryApi extends Context.Service<DirectoryApi, DirectoryApiShape>()(
  "@unitflow/example/paginated-table/DirectoryApi",
) {}

const REPO_PAGE = 12;
const CONTRIBUTOR_PAGE = 8;

const LANGUAGES: ReadonlyArray<Language> = ["TypeScript", "Rust", "Go", "Python"];
const PREFIXES = ["orbit", "quartz", "ember", "delta", "prism", "cobalt", "lumen", "raven"];
const SUFFIXES = ["kit", "core", "flow", "graph", "cache", "queue", "forge"];
const FIRST_NAMES = ["Mira", "Noah", "Ira", "Sanne", "Tomas", "Vera", "Ilya", "Ada", "Piet", "Nina"];
const LAST_NAMES = ["Castel", "Brandt", "Okafor", "Lindqvist", "Marchetti", "Vos", "Ehrlich", "Sato"];

/** Deterministic pseudo-randomness so every reload shows the same directory. */
const vary = (seed: number, span: number): number => ((seed * 2654435761) >>> 16) % span;

const repos: ReadonlyArray<Repo> = Array.from({ length: 57 }, (_, index) => {
  const prefix = PREFIXES[index % PREFIXES.length];
  const suffix = SUFFIXES[vary(index, SUFFIXES.length)];
  return {
    id: `repo-${index + 1}`,
    name: `${prefix}-${suffix}`,
    language: LANGUAGES[vary(index + 3, LANGUAGES.length)] ?? "TypeScript",
    stars: 40 + vary(index + 7, 9600),
    contributorsTotal: 5 + vary(index + 11, 38),
  };
});

const contributorsOf = (repo: Repo): ReadonlyArray<Contributor> =>
  Array.from({ length: repo.contributorsTotal }, (_, index) => {
    const seed = vary(index + repo.stars, 10_000);
    const first = FIRST_NAMES[seed % FIRST_NAMES.length];
    const last = LAST_NAMES[vary(seed, LAST_NAMES.length)];
    return {
      id: `${repo.id}-member-${index + 1}`,
      name: `${first} ${last}`,
      commits: 1 + vary(seed + index, 900),
    };
  });

const tokenOf = (offset: number): string => `page@${offset}`;
const offsetOf = (token: string | null): number =>
  token === null ? 0 : Number.parseInt(token.slice("page@".length), 10) || 0;

export const directoryApi = DirectoryApi.of({
  repos: ({ language, cursor }) =>
    Effect.gen(function* () {
      yield* Effect.sleep("350 millis");
      const matching = repos.filter(
        (repo) => language === "all" || repo.language === language,
      );
      const offset = offsetOf(cursor);
      const items = matching.slice(offset, offset + REPO_PAGE);
      const nextOffset = offset + REPO_PAGE;
      return nextOffset < matching.length
        ? { items, next: tokenOf(nextOffset) }
        : { items };
    }),

  contributors: ({ repoId, skip }) =>
    Effect.gen(function* () {
      yield* Effect.sleep("450 millis");
      const repo = repos.find((candidate) => candidate.id === repoId);
      const all = repo === undefined ? [] : contributorsOf(repo);
      const items = all.slice(skip, skip + CONTRIBUTOR_PAGE);
      const next = skip + CONTRIBUTOR_PAGE;
      return next < all.length ? { items, next } : { items };
    }),
});
