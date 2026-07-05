import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contentDocsRoot = resolve(root, "src/content/docs");
const markdownFiles = [];
const ignoredDirectories = new Set([".astro", ".git", "dist", "node_modules", "repos"]);

/** A page file backing a Starlight route slug, trying both source extensions
 * (a slug does not encode which one the page happens to use). */
const slugFileExists = (slug) => {
  const withoutTrailingSlash = slug.replace(/\/$/, "");
  const base = withoutTrailingSlash === "" ? "index" : withoutTrailingSlash;
  return existsSync(join(contentDocsRoot, `${base}.md`)) || existsSync(join(contentDocsRoot, `${base}.mdx`));
};

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (ignoredDirectories.has(entry)) continue;
      walk(path);
      continue;
    }
    if (path.endsWith(".md") || path.endsWith(".mdx")) markdownFiles.push(path);
  }
};

walk(root);

const missing = [];
const todo = [];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const source = readFileSync(file, "utf8");
  if (source.includes("[TODO") || source.includes("TODO:")) todo.push(file);

  for (const match of source.matchAll(linkPattern)) {
    const href = match[1];
    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("#") ||
      href.startsWith("mailto:")
    ) {
      continue;
    }
    const [target] = href.split("#");
    if (target.length === 0) continue;
    // A leading slash is a Starlight route (e.g. `/examples/task-board/`),
    // not a filesystem-absolute path — resolve it against the docs root.
    // Relative links crossing into a subdirectory (`./examples/x.md` from a
    // sibling page) are NOT rewritten to a clean route by Astro at render
    // time, so prefer the `/slug/` form for any cross-directory doc link.
    const exists = target.startsWith("/")
      ? slugFileExists(target)
      : existsSync(resolve(dirname(file), target));
    if (!exists) missing.push(`${file} -> ${href}`);
  }
}

if (todo.length > 0 || missing.length > 0) {
  if (todo.length > 0) {
    console.error("TODO markers remain:");
    for (const file of todo) console.error(`- ${file}`);
  }
  if (missing.length > 0) {
    console.error("Broken markdown links:");
    for (const link of missing) console.error(`- ${link}`);
  }
  process.exit(1);
}

console.log(`Checked ${markdownFiles.length} markdown files.`);
