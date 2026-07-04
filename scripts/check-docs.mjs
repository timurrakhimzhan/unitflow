import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const markdownFiles = [];

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".git") continue;
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
    const resolved = resolve(dirname(file), target);
    if (!existsSync(resolved)) missing.push(`${file} -> ${href}`);
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
