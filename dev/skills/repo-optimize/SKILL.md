---
name: repo-optimize
description: 'User-invokable audit + optimization skill for the rules / skills / agents / CLAUDE.md surface that affects the current repo. Triggers — user invokes `/repo-optimize`, says "optimize my rules", "audit my CLAUDE.md", "what can I trim from .claude/", "are my rules duplicated", "reduce token usage in this repo", "my context is getting full from rules", "find machine-specific stuff in plugins"; about to spend a session manually scanning rules. Loads the full audit checklist (in-repo + global + plugin scope) so the agent runs an ORDERED diagnostic — never random — and reports a prioritized fix plan with concrete savings estimates and migration steps. NEVER applies fixes without explicit per-finding user approval; this is read-only audit + recommendations until the user picks targets.'
---

# Repo Optimize — Audit Rules / Skills / Agents / CLAUDE.md

## What this skill does

Scans every always-loaded surface that costs context tokens in the CURRENT repo, plus the global `~/.claude/` surfaces that bleed into every session, and reports a prioritized punch list of:

- **Bloat** — rules / sections that are bigger than they need to be for the load-bearing invariant.
- **Duplication** — same concept covered in multiple places (rule + rule, rule + skill, CLAUDE.md + rule).
- **Skillify candidates** — content that's only needed during specific edits and could move to a triggered skill.
- **Machine-specific refs** — paths, hostnames, ports, account IDs, personal email/repo names that break portability if the rule/skill is shared.
- **Dead pointers** — refs to deleted / renamed files or skill names.
- **Missing skill triggers** — repo CLAUDE.md doesn't tell agents WHICH skill to invoke for a given trigger.
- **Plugin set audit** — enabled plugins that don't match this repo's actual workflow (e.g. `human-collaboration` enabled on a dispatched-worker repo).

Read-only. Reports findings. User approves which fixes to execute, then a follow-up turn applies them.

## TodoWrite checklist (mandatory on first invoke)

Write these as TodoWrite items + tick off in order. The order matters — early findings inform later ones.

### Phase 1 — Inventory (5 min)

1. List every file under `<repo>/.claude/` (rules, skills, agents, settings.json) with line counts.
2. Read `<repo>/CLAUDE.md` — note total line count.
3. Read `~/.claude/CLAUDE.md` — note total line count (this loads in EVERY session).
4. Read `<repo>/.claude/settings.json` `enabledPlugins` block.
5. Read `~/.claude/settings.json` `enabledPlugins` block (always-on plugins).
6. For each enabled plugin: `ls ~/web/claude-plugins/<plugin>/skills/` → list available skills with descriptions.
7. Read any workspace-level `<repo>/.danxbot/workspaces/*/.claude/settings.json` if the repo has them.

Output: token-count table per file (line count × ~5 = rough token count).

### Phase 2 — Bloat scan (10 min)

For each rule file in `<repo>/.claude/rules/*.md` AND `<repo>/CLAUDE.md`:

1. Identify the **load-bearing invariant** in 1-3 sentences. (What is the SINGLE thing this rule prevents?)
2. Identify everything ELSE in the file: schema dumps, code samples, "why we did X" rationale, deep contracts, error tables, config examples.
3. Flag every section >20 lines that ISN'T the load-bearing invariant.
4. Cross-check: does an existing skill in any enabled plugin already carry this content? If yes → duplication; if no → skillify candidate.

For `<repo>/CLAUDE.md` specifically:
- Architecture overview + tech stack: keep, this is project orientation.
- Per-feature deep contracts (security model, schema, lifecycle): skillify candidate.
- Workflow steps (TDD, quality gates): usually duplicates `pipeline:*` or `dev:*` skills.
- Skill-pointer table: REQUIRED — flag if missing or stale.

Output: per-file table — `file | load-bearing invariant (≤3 lines) | bloat sections | skillify-target plugin`.

### Phase 3 — Duplication scan (5 min)

1. `grep -rn` for identical headers across rule files (e.g. "Forbidden Patterns" appearing in two rules).
2. `grep -rn` for skill-name mentions in rules — count which skills each rule points at.
3. Look for the same architectural concept explained in `CLAUDE.md` + a `.claude/rules/*.md` file + a plugin skill — pick ONE home.
4. Look for duplicate plugin skills across enabled plugins (e.g. `host-environment` shipped by both `pipeline` and `human-collaboration`).

Output: duplication map — `concept | locations[] | recommended single home`.

### Phase 4 — Machine-specific ref scan (5 min)

`grep -rn` patterns across `<repo>/.claude/`, `<repo>/CLAUDE.md`, `~/.claude/CLAUDE.md`, AND every enabled plugin under `~/web/claude-plugins/`:

| Pattern | Severity | Action |
|---|---|---|
| `/home/<user>/`, `~/web/<repo>/` (operational, not illustrative) | high | replace with `<REPO_ROOT>` placeholder or generalize |
| Hardcoded hostnames (`*.sageus.ai`, IPs, `localhost:<specific-port>` outside HMR docs) | high | replace with `<your-deployment>` placeholder |
| Personal repo names (`gpt-manager`, `platform`, `mcp-server-trello`) where the skill claims to be generic | medium | use `<connected-repo>` or `<your-repo>` placeholder |
| `@<scope>/*` package names (where scope is owner-personal) outside the dedicated owner-skill | medium | confirm intentional scope; otherwise generalize |
| Personal email in `plugin.json` `author.email` | low | leave (standard plugin metadata) |
| Windows paths (`C:\Windows\`, `powershell.exe`, `wt.exe`) outside the dedicated host-environment skill | high | move to global `~/.claude/settings.json` (machine-specific) |
| Specific Trello board / list / label IDs | high | move to repo `.danxbot/config/trello.yml` or generalize |
| Specific Make targets that only exist in ONE repo's Makefile | medium if outside that repo's plugin | move to that repo's plugin or generalize |

Output: file:line table grouped by severity. Distinguish "operational ref" (the path IS the rule) from "illustrative example" (the path explains a concept).

### Phase 5 — Dead pointer scan (5 min)

For every `.claude/rules/*.md` file referenced in `CLAUDE.md` or any rule:
1. Verify file exists.
2. For every skill name (`<plugin>:<skill>`) referenced: verify skill exists in an ENABLED plugin.
3. For every `<file>:<line>` ref: verify file exists (line numbers will drift, just check file existence).
4. For every URL ref: WebFetch sample to verify reachable (skip if user requested no network).

Output: list of broken refs with file:line of the bad reference.

### Phase 6 — Missing skill triggers (5 min)

Read `<repo>/CLAUDE.md` — does it have a "skill triggers" table that maps:
- Edit `<file>` → invoke `<skill>`
- User says `<phrase>` → invoke `<skill>`
- About to run `<command>` → invoke `<skill>`

For each enabled plugin's skills with `MANDATORY` triggers in their description: confirm the trigger appears in the repo's CLAUDE.md skill table OR is so generic that the skill auto-fires. Flag any MANDATORY skill that has zero pointer in CLAUDE.md — that's a discoverability bug.

Output: list of skills with no CLAUDE.md pointer.

### Phase 7 — Plugin set audit (3 min)

For the repo's enabled plugins:
1. Does the repo actually use this plugin's skills? Grep for skill name references.
2. Is any plugin enabled redundantly (already covered by another)?
3. Is any needed plugin missing? (e.g. `dev:debugging` not enabled on a code-writing repo)
4. For workspace-level `.claude/settings.json` files: should this dispatched worker have `human-collaboration:human-loop`? (Almost always NO — diagnostic-mode-on-question would deadlock the worker.)

Output: plugin-set delta with reasoning.

### Phase 8 — Global surface audit (3 min)

`~/.claude/CLAUDE.md` loads in EVERY session in EVERY project on this machine. Apply Phases 2-4 to it specifically. Common waste:
- Personal-package publish tables (only relevant when editing those packages → skillify).
- Machine-specific paths in always-on global rule (move to a global skill triggered when relevant).
- Plugin source/marketplace location: KEEP (load-bearing meta-rule).

`~/.claude/settings.json` hooks: scan for hooks that fire on every session but only matter for specific repos.

`~/.claude/agents/*.md`: any agent that's truly generic should live in a plugin (`base/` or `dev/`) so other machines benefit.

Output: per-finding, recommend "stay global / move to plugin / move to repo / delete".

## Reporting format

Compose a single report with these sections, in this order:

1. **Token spend snapshot** — total memory file tokens currently always-loaded in this repo. Format: `<file>: <lines> ≈ <tokens>`. Sum at bottom.
2. **Top 5 wins** — highest token-savings finding first. Format: `[<savings>] <one-line description> → <action>`.
3. **Bloat findings** — Phase 2 output.
4. **Duplication findings** — Phase 3 output.
5. **Machine-ref findings** — Phase 4 output.
6. **Dead pointers** — Phase 5 output.
7. **Missing skill triggers** — Phase 6 output.
8. **Plugin set delta** — Phase 7 output.
9. **Global surface findings** — Phase 8 output.
10. **Recommended migration plan** — ordered list of steps with effort/risk per step.

End with: "Pick which findings to execute. I will NOT apply any fix without per-finding approval."

## Hard rules

- **Read-only**. NEVER edit a file in this skill's invocation. Report → user picks → next turn applies.
- **No "obviously fine" exemption**. If a section duplicates another by ≥80%, flag it. Don't pre-decide for the user.
- **Distinguish illustrative from operational**. A path used as an EXAMPLE in prose (`see e.g. ~/web/foo/bar.ts`) is lower severity than a path the rule REQUIRES (`run cd /home/newms/web/danxbot`). Always note which.
- **Surface global findings even when scope is the repo**. `~/.claude/CLAUDE.md` and `~/.claude/settings.json` affect THIS repo's session — they're in scope.
- **Quote, don't paraphrase**. When flagging a bloat section, quote the first 1-2 lines verbatim so the user can find it.
- **Respect skill-source-of-truth**. If a rule's source-of-truth is a plugin (per `~/.claude/CLAUDE.md` MANDATORY pre-edit check), recommend editing the plugin source, not the repo-local copy.

## Example invocation flow

User: `/repo-optimize`

Agent runs Phase 1-8 sequentially, takes ~30 min on a medium repo.

Agent reports:

```
Token spend: 36k always-loaded
Top 5 wins:
1. [~5k] CLAUDE.md duplicates Trello-bg section that exists in agent-dispatch.md → trim CLAUDE.md
2. [~3k] settings-file.md schema can move to <plugin>:settings-deep skill → skillify
3. [~2k] production-access.md duplicates prod-access plugin skill → delete file
4. [~1k] 4 rule files reference deleted host-mode-interactive.md → repoint refs
5. [~700/session globally] @thehammer publish in ~/.claude/CLAUDE.md → skillify

Pick targets to execute.
```

User picks → next turn applies the chosen subset.

## When to NOT use this skill

- During active feature development (use during housekeeping turns instead).
- If the repo is < 1k tokens of always-loaded rules (no payoff).
- For code-quality reviews (use `caveman:caveman-review` or `code-review:code-review` instead).
