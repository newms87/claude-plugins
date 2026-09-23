#!/usr/bin/env node
//
// Post-delivery check for scripts/publish.sh (DX-3057).
//
// After publish.sh bumps + pushes a plugin's version and runs
// update-plugins.sh, this proves the bump is actually LIVE on this
// machine rather than assuming a zero exit from update-plugins.sh means
// so. It reads this machine's installed_plugins.json + plugin cache
// directly and compares every live row against the version just
// published.
//
// Rules (no silent defaults, no read-time fallbacks — every shape
// question is either satisfied or an error):
//   - installed_plugins.json must parse and must contain at least one
//     row for <plugin>@<marketplace>.
//   - a row missing `scope` or `version` is an ERROR naming the row
//     (never defaulted to "user" / "?").
//   - a user-scope row is REQUIRED. No user-scope row among the plugin's
//     entries is an ERROR.
//   - a row's `projectPath`, when present, is checked with
//     fs.lstatSync in a try/catch (not fs.existsSync, which follows
//     symlinks/junctions and can misreport a dangling one) — a path
//     that no longer exists on disk is SKIPPED, not failed.
//   - every row whose projectPath exists (or has none, i.e. user scope)
//     must have `version === expected`.
//   - the newest version directory under <cacheRoot>/<plugin> must also
//     equal `expected`.
//
// Exit 0 only if every checked row matches and the cache is current.
// Exit 1 on any mismatch OR any read/shape error, printing one line per
// row (OK / SKIPPED / MISMATCH) plus any structural errors, so the
// caller (publish.sh) can just check the exit status.
//
// Usage:
//   node scripts/verify-delivery.mjs <installedFile> <cacheRoot> <marketplace> <plugin> <expected>

import fs from "fs";
import path from "path";

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const NC = "\x1b[0m";

function err(msg) {
  process.stderr.write(`${RED}${msg}${NC}\n`);
}
function info(msg) {
  process.stdout.write(`${YELLOW}${msg}${NC}\n`);
}
function ok(msg) {
  process.stdout.write(`${GREEN}${msg}${NC}\n`);
}

function main() {
  const [installedFile, cacheRoot, marketplace, plugin, expected] = process.argv.slice(2);
  if (!installedFile || !cacheRoot || !marketplace || !plugin || !expected) {
    err(
      "Usage: verify-delivery.mjs <installedFile> <cacheRoot> <marketplace> <plugin> <expected>"
    );
    process.exit(1);
  }

  const pluginId = `${plugin}@${marketplace}`;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(installedFile, "utf8"));
  } catch (e) {
    err(`  ${plugin}: ERROR reading ${installedFile}: ${e.message}`);
    process.exit(1);
  }

  const entries = (data.plugins && data.plugins[pluginId]) || [];
  if (entries.length === 0) {
    err(`  ${plugin}: ERROR: no rows found for ${pluginId} in ${installedFile}`);
    process.exit(1);
  }

  // Validate shape up front — a row missing scope/version is an error,
  // never a guessed default.
  let shapeFailed = false;
  entries.forEach((entry, i) => {
    if (typeof entry.scope !== "string" || entry.scope.length === 0) {
      err(`  ${plugin}: ERROR: row ${i} for ${pluginId} is missing 'scope'.`);
      shapeFailed = true;
    }
    if (typeof entry.version !== "string" || entry.version.length === 0) {
      err(`  ${plugin}: ERROR: row ${i} for ${pluginId} is missing 'version'.`);
      shapeFailed = true;
    }
  });
  if (shapeFailed) process.exit(1);

  const hasUserRow = entries.some((entry) => entry.scope === "user");
  if (!hasUserRow) {
    err(`  ${plugin}: ERROR: no user-scope row found for ${pluginId} in ${installedFile}.`);
    process.exit(1);
  }

  // Newest cache dir.
  const pluginCachePath = path.join(cacheRoot, plugin);
  let newestCache = null;
  try {
    const dirs = fs
      .readdirSync(pluginCachePath)
      .filter((d) => /^\d+\.\d+\.\d+$/.test(d));
    dirs.sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return 0;
    });
    newestCache = dirs.length ? dirs[dirs.length - 1] : null;
  } catch (e) {
    err(`  ${plugin}: ERROR reading cache at ${pluginCachePath}: ${e.message}`);
    process.exit(1);
  }
  if (!newestCache) {
    err(`  ${plugin}: ERROR: no cache versions found at ${pluginCachePath}`);
    process.exit(1);
  }

  let failed = false;
  if (newestCache !== expected) {
    err(
      `  ${plugin}: MISMATCH: expected v${expected} but newest cache dir at ${pluginCachePath} is '${newestCache}'.`
    );
    failed = true;
  }

  for (const entry of entries) {
    const label =
      entry.scope === "user"
        ? "user"
        : `${entry.scope} @ ${entry.projectPath ? path.basename(entry.projectPath) : "?"}`;

    if (entry.projectPath) {
      let exists = true;
      try {
        fs.lstatSync(entry.projectPath);
      } catch {
        exists = false;
      }
      if (!exists) {
        info(`  ${plugin} [${label}]: SKIPPED (project path missing: ${entry.projectPath})`);
        continue;
      }
    }

    if (entry.version === expected) {
      ok(`  ${plugin} [${label}]: v${expected} confirmed installed.`);
    } else {
      err(
        `  ${plugin} [${label}]: expected v${expected} but installed_plugins.json shows '${entry.version}'.`
      );
      failed = true;
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
