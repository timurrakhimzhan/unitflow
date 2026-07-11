#!/usr/bin/env node
// Publishes @unitflow/{core,react,router} to npm — but only whichever ones
// have a package.json version that isn't live in the registry yet. Order
// matters: core before react before router, so a dependent's resolved
// "@unitflow/core": "^x.y.z" range (via `pnpm pack`, which reads the LOCAL
// workspace version, not the registry) is already installable by the time
// it's published.
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packages = ["core", "react", "router"];

const publishedVersion = (name) => {
  try {
    return execSync(`npm view ${name} version`, { encoding: "utf8" }).trim();
  } catch {
    return null; // never published
  }
};

for (const pkg of packages) {
  const dir = `packages/${pkg}`;
  const { name, version } = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  const published = publishedVersion(name);

  if (published === version) {
    console.log(`${name}@${version} already published, skipping`);
    continue;
  }

  console.log(`Publishing ${name}@${version} (registry has ${published ?? "nothing yet"})`);
  const tmp = mkdtempSync(join(tmpdir(), "unitflow-publish-"));
  execSync(`pnpm pack --pack-destination ${tmp}`, { cwd: dir, stdio: "inherit" });
  const [tarball] = readdirSync(tmp);
  execSync(`npm publish ${join(tmp, tarball)} --access public`, { stdio: "inherit" });
}
