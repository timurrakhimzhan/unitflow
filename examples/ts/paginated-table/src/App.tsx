import * as React from "react";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { View } from "@unitflow/react";
import { type LanguageFilter } from "./directory";
import { ContributorsModel, RepoTableModel } from "./model";

const languages: ReadonlyArray<LanguageFilter> = ["all", "TypeScript", "Rust", "Go", "Python"];

const formatStars = (stars: number): string =>
  stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : String(stars);

/**
 * Hover/focus state is presentation state, so it lives in React; `onOpen`
 * tells the model to materialize the popover's unit. The small open delay
 * keeps a mouse sweep across rows from materializing a unit per row.
 */
const HoverPopover = ({
  label,
  onOpen,
  children,
}: {
  readonly label: React.ReactNode;
  readonly onOpen: () => void;
  readonly children: React.ReactNode;
}) => {
  const [open, setOpen] = React.useState(false);
  const openTimer = React.useRef<number | undefined>(undefined);

  const show = () => {
    setOpen(true);
    onOpen();
  };
  const openSoon = () => {
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(show, 150);
  };
  const close = () => {
    window.clearTimeout(openTimer.current);
    setOpen(false);
  };
  React.useEffect(() => () => window.clearTimeout(openTimer.current), []);

  return (
    <span
      className="popover-anchor"
      onMouseEnter={openSoon}
      onMouseLeave={close}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <button
        type="button"
        className="popover-trigger"
        aria-expanded={open}
        onFocus={show}
        onBlur={close}
      >
        {label}
      </button>
      {open ? <div className="popover">{children}</div> : null}
    </span>
  );
};

/** `loadMore` is a guarded no-op while loading or exhausted, so firing it on
 * every near-bottom scroll event needs no debouncing. */
const nearBottom = (element: HTMLElement): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight < 48;

const ContributorsPanel = View.make(ContributorsModel, (unit) => {
  const loaded = AsyncResult.value(unit.contributors);
  if (Option.isNone(loaded)) {
    return <div className="popover-status">Loading contributors…</div>;
  }

  return (
    <div
      className="popover-scroll"
      onScroll={(event) => {
        if (nearBottom(event.currentTarget)) unit.loadMore();
      }}
    >
      <ul className="contributor-list">
        {loaded.value.map((contributor) => (
          <li key={contributor.id}>
            <span>{contributor.name}</span>
            <span className="contributor-commits">{contributor.commits} commits</span>
          </li>
        ))}
      </ul>
      {unit.contributors.waiting ? (
        <div className="popover-status">Loading more…</div>
      ) : unit.hasMore ? null : (
        <div className="popover-status">That is everyone</div>
      )}
    </div>
  );
});

export const RepoTableApp = View.make(RepoTableModel, (unit) => {
  const rows = AsyncResult.value(unit.rows);
  const panelByRepo = new Map(
    unit.contributorPanels.map((panel) => [panel.key.repoId, panel]),
  );

  return (
    <main className="table-shell">
      <header className="table-toolbar">
        <h1>Repositories</h1>
        <label>
          <span>Language</span>
          <select
            value={unit.language}
            onChange={(event) => unit.setLanguage(event.currentTarget.value as LanguageFilter)}
          >
            {languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => unit.refresh()}>
          Refresh
        </button>
      </header>

      <table className="repo-table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Language</th>
            <th>Stars</th>
            <th>Contributors</th>
          </tr>
        </thead>
        <tbody>
          {Option.isNone(rows) ? (
            <tr>
              <td className="table-status" colSpan={4}>
                Loading repositories…
              </td>
            </tr>
          ) : (
            rows.value.map((repo) => {
              const panel = panelByRepo.get(repo.id);
              return (
                <tr key={repo.id}>
                  <td>{repo.name}</td>
                  <td>{repo.language}</td>
                  <td>{formatStars(repo.stars)}</td>
                  <td>
                    <HoverPopover
                      label={`${repo.contributorsTotal} contributors`}
                      onOpen={() => unit.openContributors(repo.id)}
                    >
                      {panel === undefined ? (
                        <div className="popover-status">Loading contributors…</div>
                      ) : (
                        <ContributorsPanel unit={panel} />
                      )}
                    </HoverPopover>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <footer className="table-footer">
        {unit.hasMore ? (
          <button type="button" disabled={unit.rows.waiting} onClick={() => unit.loadMore()}>
            {unit.rows.waiting ? "Loading…" : "Load more"}
          </button>
        ) : Option.isSome(rows) ? (
          <span className="table-status">All {rows.value.length} repositories loaded</span>
        ) : null}
      </footer>
    </main>
  );
});
