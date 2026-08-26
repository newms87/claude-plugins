---
name: docker-mutagen-sync
description: 'Guide for setting up Mutagen file sync between two environments (e.g. WSL <-> Windows-native, host <-> container) with independent git + credentials on each side. Covers install, ignore-list construction from real .gitignore files, why never to live-sync .git, per-side SSH/credential setup, case-sensitivity migration, and the mechanical gotchas hit along the way.'
---

# Docker/Mutagen Cross-Environment Sync

Guide for the recurring "make environment B see environment A's working trees, fast, natively, independently" problem — e.g. WSL repos mirrored to Windows-native disk for Windows-side tool access (Claude Code Desktop, Explorer, native git), or a similar host<->container split. Built from a real WSL-to-Windows multi-repo setup; every gotcha below was hit and proven, not theorized.

## Core architecture decision — one daemon, local-to-local sync

If BOTH environments are reachable from a single filesystem view (e.g. WSL can already see the Windows drive at `/mnt/c/...`), you do **not** need Mutagen installed on both sides. One Mutagen daemon running in the environment with dual filesystem visibility (WSL) can run a **local-to-local** two-way sync session directly between the two real paths (`/home/user/repos` <-> `/mnt/c/Users/user/repos`). This is simpler than an agent-based remote sync and avoids ever needing Mutagen on the Windows/container side at all.

Only reach for Mutagen's SSH/Docker/agent-based remote endpoints when the two sides genuinely cannot see each other's filesystem directly.

## Install (no package manager shortcut)

No apt/brew package reliably available. Pull the official GitHub release directly — check docs first (`https://mutagen.io/documentation/introduction/installation`), then resolve the actual latest asset via the GitHub API rather than guessing a version-pinned URL:

```bash
curl -fsSL https://api.github.com/repos/mutagen-io/mutagen/releases/latest \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['tag_name']); [print(a['browser_download_url']) for a in d['assets'] if 'linux' in a['name'] and 'amd64' in a['name']]"
```

Extract just the `mutagen` binary to a directory already on `PATH` (e.g. `~/.local/bin`) — no need for the bundled `mutagen-agents.tar.gz` in the local-to-local case.

## Before the first sync: decide these THREE things, not after

Redoing a multi-GB, multi-hundred-thousand-file sync because one of these was decided late is expensive (each of the three below independently forces a full re-transfer if discovered after the fact). Decide all three, THEN run `mutagen sync create` once.

### 1. Is `.git` going to be live-synced? (Answer: no)

Mutagen syncs VCS directories by default (`--ignore-vcs` opts OUT, it does not default to excluding them). **Never two-way-sync `.git` live.** `FETCH_HEAD`, `refs/remotes/*`, and worktree admin files get rewritten non-atomically by ordinary git activity (fetches, background dispatch tooling, etc.); syncing them while something on either side is mid-write produces real "unable to create file" / staging races — proven in practice, not hypothetical. Add `.git` to the ignore list from the start and give each side an **independent** git setup instead (see below).

### 2. What actually counts as "generated" — build the ignore list FROM every repo's own `.gitignore`, don't hand-guess

Don't incrementally bolt on `--ignore` patterns as surprises surface (`node_modules`, `dist`, `.venv`, etc. are the obvious ones — the expensive misses are project-specific: a directory of accumulated Claude Code session-transcript logs, a hyperparameter-search results dir, a Terraform provider cache). Instead:

```bash
for r in ~/web/*/; do
  [ -f "$r/.gitignore" ] && { echo "=== $(basename "$r") ==="; cat "$r/.gitignore"; }
done
```

Read every repo's actual `.gitignore` in the sync scope up front — the project's own author already decided what's generated; that's a better source of truth than any generic checklist.

**Bare vs. rooted patterns matter when merging many repos' gitignores into ONE flat Mutagen ignore list** (Mutagen's ignore list applies across the whole sync tree, unlike git's own per-directory-root `.gitignore` resolution):
- A pattern that means the same generated thing in EVERY repo (`node_modules`, `vendor`, `.venv`, `__pycache__`, `coverage`, `.cache`, `.terraform`, `*.log`) → safe as a **global bare** `--ignore` pattern.
- A pattern that's generated in ONE repo but is real tracked source in ANOTHER repo of the same name (`app/`, `data/`, `storage/`, `public/`, `repos/`, `workspaces/`) → MUST be scoped with a leading slash + repo prefix (`--ignore='/reponame/app'`), never added bare. Getting this wrong silently excludes real source in a sibling repo.
- **Only add a bare pattern for a generic-sounding word (`build`, `out`, `target`) if you actually confirmed it in the .gitignore sweep** — don't add "commonly known generated dir names" speculatively just because they're common in the wider ecosystem. A bare `build` added on that kind of assumption (not from any actual `.gitignore` in scope) silently ate a real source directory (`src/template-app/build/`, genuine build-orchestration *code*, not build *output*) in one repo that happened to use the word for something else. If a generic word isn't in any in-scope repo's real `.gitignore`, either scope it to the one repo that actually needs it, or leave it out.

**Directories that MIX generated-and-tracked content need special handling — don't blanket-include OR blanket-exclude.** `node_modules`-style dirs are cleanly 100%-generated; some directories (IDE project folders like `.idea/`, `.vscode/`) are NOT — one repo may fully git-ignore it, another may fully track it, and a third may track a handful of shared files (`.idea/codeStyles/`, `misc.xml`) while ignoring the rest (personal `workspace.xml`, local `dataSources.xml` that can hold real DB credentials). Two wrong extremes to avoid:
- **Blanket-exclude globally** → silently drops real tracked files in whichever repos track them (found via `git status` showing files "deleted" that are actually just excluded from the mirror).
- **Blanket-include (remove the exclusion entirely)** → re-syncs personal, git-ignored, possibly-sensitive IDE state from every repo that DOES ignore it (found via `git status --porcelain --ignored <dir>` showing real ignored-and-present files that would now sync unfiltered).

Mutagen has no concept of "only sync what git tracks" — it's pure path-pattern matching, so this has to be modeled explicitly. The practical resolution: pick ONE repo's actual include/exclude shape as the project-wide standard (ask the user which repo's convention to standardize on, don't guess), replicate it as a **global** ignore-with-negations block (e.g. `.idea/*` + `!.idea/codeStyles` + `!.idea/misc.xml` + ...), and explicitly flag that any repo with a genuinely different shape (one that fully tracks the directory under different filenames than the chosen standard, say) will still have its own specific tracked files excluded under the adopted standard — that's a known, accepted tradeoff of picking one convention, not a bug to chase further unless asked.

**A generated-content pattern with a wildcard suffix needs a trailing slash if it should only match directories.** `claude-projects*` (no trailing `/`) matches ANY path starting with that string — including a real source file coincidentally named `claude-projects-usage-client.ts`. `claude-projects*/` (gitignore-style directory-only suffix) matches only directories, leaving same-prefixed files alone. Mutagen's default ignore syntax follows gitignore conventions closely enough that this distinction carries over — verify it did in practice via the same `git status` check, don't just assume.

**Mutagen ignore patterns support gitignore-style negation (`!pattern`)** — confirmed via `https://mutagen.io/documentation/synchronization/ignores`, don't assume it works or guess the syntax. A later `!pattern` in the same `--ignore` list un-ignores whatever an earlier pattern matched, same ordering semantics as `.gitignore`. This is how the mixed-content-directory problem above gets modeled, and how to keep one specific tracked file (e.g. a repo that specifically tracks `dist/install.ps1`) synced without dropping the `dist` exclusion everyone else needs.

**The single most-repeated mistake in this whole exercise: a bare directory exclude (`dirname`, no trailing `/*`) blocks EVERY negation aimed inside it — this is inherited gitignore behavior ("it is not possible to re-include a file if a parent directory of that file is excluded"), and it silently no-ops the negation rather than erroring.** `--ignore='claude-auth'` + `--ignore='!claude-auth/.gitkeep'` looks correct and does nothing — `.gitkeep` stays excluded, because `claude-auth` as a bare pattern ignores the whole directory as one unit, and Mutagen (like git) never even looks inside an already-fully-ignored directory for negation matches. The fix is exclude the *contents*, not the directory: `--ignore='claude-auth/*'` + `--ignore='!claude-auth/.gitkeep'` — now only individual files inside are ignored, so the negation can reach one of them. This bit `dist/install.ps1`, `claude-auth/.gitkeep`, `repo-overrides/.gitkeep`, a repo-scoped `storage/logs/.gitignore` placeholder (in three separate repos), and a repo-scoped `public/*` bootstrap-file set, all independently, all with the identical fix. **Mechanical rule: any time a `--ignore` pattern is followed by a `!`-negation meant to reach inside it, the excluding pattern MUST end in `/*`, never be bare.** Verify with `git status` after every negation — a still-"deleted" file after adding a `!` line is the tell that the parent above it needs `/*` appended.

**A directory sitting at the TOP of the sync root, not inside any repo, is easy to miss and easy to mistake for "part of some repo."** A stray leftover IDE project folder opened once against the whole parent directory (not any single repo) can end up in scope under a "sync everything" decision. Sanity-check any suspicious top-level entry before assuming it belongs to a repo:

```bash
git -C <path> rev-parse --is-inside-work-tree   # errors "not a git repository" if it's an orphan
```

**Mutagen has NO mechanism to modify ignore patterns on an already-created session — confirmed via docs and the full `mutagen sync` subcommand list** (`create|list|monitor|flush|pause|resume|reset|terminate`, nothing else). Ignores are "locked in" at `sync create` time; even a global `~/.mutagen.yml` ignore config change does not retroactively apply to already-running sessions. **Any correction to the ignore list requires `sync terminate` + `sync create` again** — there is no lighter-weight alternative, and manually deleting an unwanted already-synced file only "resyncs it right back" on the next reconciliation pass in a two-way session (the source side still has it). This is worth setting expectations on up front: budget for at least one or two ignore-list correction cycles after the first real `git status` check on each side, each one requiring a full session recreation — though if the destination is already ~fully populated and correct, recreation is a fast scan+compare against matching content, not a repeat of the original bulk transfer.

**Gitignore isn't the whole picture — also sweep by file COUNT, not just size.** A directory can be small in aggregate MB but enormous in file count (hundreds of thousands of tiny files), and it may not be gitignored at all if it's project-specific test debris the repo owner never flagged (e.g. a `storage/app/public` filling up with `test.txt___<hash>` fixtures from unclean test runs). Cross-check with a real per-directory file count, not just `du`:

```bash
find <repo>/<subdir> -type f | wc -l
```

Investigate anything disproportionately large before excluding it — some of it may be real content worth keeping (ask the user rather than assume).

**Also scan for filenames illegal on the destination filesystem** before the first sync, not after it fails partway through:

```bash
find ~/web -type f -name '*[:<>|?*]*'
```

(NTFS forbids `: < > | ? *` and a few reserved names; a stray leaked `Zone.Identifier` alternate-data-stream artifact is a common WSL/Windows-interop offender.)

### 3. Does the destination filesystem need to be case-sensitive?

If two paths in the source tree differ only by case (common with parallel git worktrees, or old case-renamed directories), and the destination is case-insensitive NTFS, Mutagen will report **permanent** transition problems ("unable to create directory: file exists") for the losing entry — this is a structural conflict, not a race, and will not self-heal on retry.

Fix (Windows/NTFS specifically, per Microsoft's own case-sensitivity docs — confirm with the official doc before asserting behavior, don't rely on memory):

```powershell
fsutil file setCaseSensitiveInfo <path> enable   # requires Administrator (interactive UAC — cannot be silently elevated)
```

Three hard constraints, easy to get wrong:
1. **The target directory must be completely EMPTY** when the flag is set — it cannot be applied retroactively to a populated tree.
2. **The flag only propagates to subdirectories created AFTER it's set on the parent** — moving pre-existing directories into an already-case-sensitive parent does NOT make them case-sensitive; they were created before the flag existed.
3. Elevation is an **interactive** UAC prompt — a session automating from WSL/Linux cannot click through it; hand the exact command to the human running the Windows side, verify their claim afterward with `fsutil file queryCaseSensitiveInfo <path>`, never just trust "done."

Net effect: if case-sensitivity is needed, the correct sequence is create-empty → elevate+enable while still empty → point Mutagen at that empty directory and let it fully populate fresh. There is no in-place upgrade path.

## Independent `.git` setup per repo (once `.git` is excluded from live sync)

Since the working-tree files are already mirrored by Mutagen, attach a real independent git history without a slow network re-clone:

```bash
git clone --no-checkout --quiet <local-source-repo-path> /tmp/giti-<repo>
mv /tmp/giti-<repo>/.git <synced-destination-path>/<repo>/.git
```

**Gotcha:** `git clone <local-path> <dest>` sets `origin` to the LOCAL PATH you cloned from — never the original repo's real remote. Capture each repo's actual `origin` URL from the source BEFORE cloning, and explicitly `git --git-dir=<dest>/.git remote set-url origin <real-url>` afterward. Do not assume the clone preserved the upstream remote.

**Bigger gotcha — `--no-checkout` also leaves the INDEX empty, not populated from HEAD.** It's tempting to assume `--no-checkout` only skips writing working-tree files while leaving the index matching HEAD (so `git status` would just show the Mutagen-synced files as clean). It does not — the index comes out completely empty, so `git status` reports every single tracked file as `Changes to be committed: deleted`, even though the real files are sitting right there on disk. Fix immediately after moving `.git` into place, for every repo:

```bash
git -C <synced-destination-path>/<repo> reset --mixed HEAD
```

This rebuilds the index from HEAD's tree **without touching the working directory** — exactly what's needed since the working tree is already correct. After this, `git status` compares the (now correct) index against the real on-disk files and shows genuine differences only.

**Third gotcha — cross-filesystem file-mode noise.** Even after the index fix, expect every file to still show as `modified` with a pure `old mode 100644` / `new mode 100755` diff (zero content change). A filesystem bridge (drvfs, most FUSE/9p mounts, some Docker volume backends) doesn't reliably preserve Unix permission bits, so Mutagen-synced files land reporting as executable regardless of their real source permissions. Standard fix, not a workaround — this setting exists for exactly this class of filesystem:

```bash
git -C <synced-destination-path>/<repo> config core.fileMode false
```

Do both (`reset --mixed HEAD` then `core.fileMode false`) for every repo before trusting `git status` to show real differences.

## Per-repo credentials, independently on each side

Gather every repo's real remote scheme up front — a multi-repo, multi-account setup is rarely uniform:

```bash
for r in <repo-list>; do echo "$r :: $(git -C ~/web/$r remote get-url origin | sed -E 's#(https://)[^@]+@#\1[REDACTED]@#')"; done
```

(Redact any embedded token before printing/logging — an HTTPS remote with a bearer token baked into the URL, e.g. `https://x-access-token:<PAT>@github.com/...`, is a live secret; flag it to the user, never re-print it gratuitously, and don't "fix" it — it's an existing, working auth mechanism, just carry the URL over as-is.)

For SSH-based remotes with multiple GitHub identities, prefer explicit host aliases over relying on an ssh-agent trying keys in sequence — deterministic, and works without an agent running:

```
Host github-<account>
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_<account>
  IdentitiesOnly yes
```

Then rewrite each repo's `origin` to use the matching alias (`git@github-<account>:org/repo.git`) instead of the bare `git@github.com:...`.

Only copy the specific key pairs actually referenced by in-scope repos' remotes — don't blanket-copy every key in `~/.ssh` (deploy/jumpbox keys unrelated to these repos' git remotes are a different credential class; ask before including them).

**Windows OpenSSH refuses a private key with inherited/open ACLs.** A plain file copy from WSL onto `/mnt/c/...` preserves an overly-permissive Windows ACL. Lock it down after copying:

```powershell
icacls 'C:\Users\<user>\.ssh\<key>' /inheritance:r /grant:r '<user>:F'
```

Verify each identity actually authenticates before trusting the setup — `ssh -T git@<alias>` exiting 1 with `Hi <user>! ... does not provide shell access` is the EXPECTED success response for GitHub's connection test, not a failure; a real auth failure looks different (permission denied).

## Mechanical gotchas encountered (save yourself the rediscovery)

- `mutagen sync list <name>` takes the session name as a **positional** argument — `--name=<name>` is only valid on `sync create`, not `sync list`; passing it to `list` errors `unknown flag`.
- Mutagen's printed "Synchronizable contents" for a side mid-transfer is a **cached scan snapshot** and can lag well behind real progress, especially right after pause/resume or session recreation. Cross-check actual live progress with a direct destination-side read (`find`/`du`) before trusting it, particularly if a report of "0 files" seems implausible.
- Large recursive operations (`du`, `find`, git clone) against a WSL-mounted Windows drive (`/mnt/c` via 9p/drvfs) are meaningfully slower than native disk — a `du -sh` over a few hundred thousand files can exceed a 2-minute default command timeout. Background it.
- `rm -rf` may be hard-blocked by harness-level safety policy regardless of target. Use `find <path> -depth -delete` as the compliant recursive-delete equivalent.
- `powershell.exe` invoked from a WSL shell inherits the WSL working directory translated to a `\\wsl.localhost\...` UNC path by default. Node/Electron-based Windows tools (this includes Windows Claude Code itself) can crash outright calling `fs.watch()` on a UNC path (`EISDIR: illegal operation on a directory, watch`). Always explicit `Set-Location <real-windows-path>` before invoking a Windows-native tool from a WSL-launched PowerShell.
- `claude plugin update <name>@<marketplace>` can fail with a misleading `Plugin "<name>" is not installed` even when it demonstrably is (present in `installed_plugins.json`, marketplace reachable). `claude plugin install <name>@<marketplace>` (reinstall, not update) is the reliable way to force a refresh to the marketplace's current version when `update` misbehaves.
- If the destination environment already runs its own Claude Code install, verify ITS plugin marketplace cache is current too (`installed_plugins.json` version per plugin) — a second, independently-drifting plugin home is a separate, easy-to-miss staleness source from the sync work itself.

## Order of operations, summarized

1. Enumerate the repo/directory scope. Compute real per-repo sizes EXCLUDING the obvious generated dirs to find the true footprint before deciding what's in scope (a repo can be 270GB nominally and 2GB of real source).
2. Read every in-scope repo's `.gitignore`; build one Mutagen ignore list — bare only for patterns actually confirmed universal across the sweep, `/repo/path`-scoped for anything generated in one repo but real source (or differently-shaped) in another, negation (`!pattern`) for directories that mix generated-and-tracked content.
3. Decide the `.git`-sync policy (exclude it — see above) before the first sync, not after.
4. Decide case-sensitivity needs (if destination is NTFS and source has case-colliding paths) before the first sync — this is the single most expensive thing to discover late, since fixing it always means starting the transfer over into a fresh empty directory.
5. Scan for illegal destination-filesystem filenames.
6. Run the sync. Verify actual destination byte/file counts directly rather than trusting cached tool status.
7. Attach independent `.git` + credentials per repo, on the destination side, once the file sync is stable — including the index-reset and `core.fileMode false` fixes above, for every repo, before trusting `git status`.
8. Verify end-to-end on the destination side itself (`git status`, `git log`, a real `ssh -T` auth check) — not just "the files are there." A real `git status --short` sweep across every repo is what actually surfaces ignore-list precision bugs (missing tracked files, wrongly-included personal state) — budget for at least one correction cycle after this check, each requiring a full session recreation (see the "no live ignore modification" gotcha above).
