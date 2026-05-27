---
name: repo-optimize
description: 'User-invokable audit of rules/skills/agents/CLAUDE.md surface — prioritized fix plan with savings estimates, read-only until user picks targets.'
---

# Repo Optimize — Audit Rules / Skills / Agents / CLAUDE.md

## What this does

Scans always-loaded surfaces in CURRENT repo + global `~/.claude/`. Reports prioritized punch list:

- **Bloat** — sections bigger than load-bearing invariant needs
- **Duplication** — same concept across rule/rule, rule/skill, CLAUDE.md/rule
- **Skillify candidates** — content only needed during specific edits
- **Machine-specific refs** — paths/hostnames/ports/IDs breaking portability
- **Dead pointers** — refs to deleted/renamed files/skills
- **Missing skill triggers** — repo CLAUDE.md missing skill-invocation pointers
- **Plugin set audit** — enabled plugins mismatched to workflow

Read-only. User approves fixes, follow-up turn applies.

## TodoWrite checklist — ordered, early findings inform later

### Phase 1 — Inventory

1. List `<repo>/.claude/` (rules, skills, agents, settings.json) with line counts
2. `<repo>/CLAUDE.md` line count
3. `~/.claude/CLAUDE.md` line count (every session)
4. `<repo>/.claude/settings.json` + `~/.claude/settings.json` `enabledPlugins`
5. For each enabled plugin: `ls ~/web/claude-plugins/<plugin>/skills/`
6. Workspace `<repo>/.danxbot/workspaces/*/.claude/settings.json` if present

Output: token-count table (lines × ~5).

### Phase 2 — Bloat scan

For each `<repo>/.claude/rules/*.md` + `<repo>/CLAUDE.md`:

1. Identify load-bearing invariant in 1-3 sentences
2. Flag every >20-line section that isn't the invariant (schema dumps, rationale, deep contracts, error tables, config examples)
3. Cross-check enabled plugins for duplicate content → duplication or skillify

`<repo>/CLAUDE.md` specifically:
- Architecture overview + tech stack: keep
- Per-feature deep contracts: skillify candidate
- TDD/quality workflow: usually duplicates `pipeline:*` / `dev:*`
- Skill-pointer table: REQUIRED, flag if missing/stale

Output: `file | invariant | bloat sections | skillify-target plugin`.

### Phase 3 — Duplication scan

1. `grep -rn` identical headers across rule files
2. Skill-name mentions per rule
3. Same concept in CLAUDE.md + rule + plugin skill → pick ONE home
4. Duplicate skills across enabled plugins

Output: `concept | locations[] | recommended single home`.

### Phase 4 — Machine-specific refs

`grep -rn` across `<repo>/.claude/`, `<repo>/CLAUDE.md`, `~/.claude/CLAUDE.md`, all enabled plugins:

| Pattern | Severity | Action |
|---|---|---|
| `/home/<user>/`, `~/web/<repo>/` operational | high | `<REPO_ROOT>` placeholder |
| Hardcoded hostnames (`*.sageus.ai`, IPs, port-specific outside HMR) | high | `<your-deployment>` |
| Personal repo names where skill claims generic | medium | `<connected-repo>` |
| `@<scope>/*` outside owner-skill | medium | confirm intentional |
| Author email in `plugin.json` | low | leave |
| Windows paths outside dedicated host-environment skill | high | move to global settings |
| Trello board/list/label IDs | high | repo config or generalize |
| Repo-specific Make targets outside that repo's plugin | medium | move to plugin |

Distinguish operational (the path IS the rule) from illustrative.

### Phase 5 — Dead pointers

For every `.claude/rules/*.md` referenced in CLAUDE.md or any rule:
1. File exists?
2. Every `<plugin>:<skill>` ref → skill exists in ENABLED plugin?
3. Every `<file>:<line>` ref → file exists? (drift expected on line)
4. URLs reachable (skip if no-network requested)

### Phase 6 — Missing skill triggers

`<repo>/CLAUDE.md` skill-triggers table maps:
- Edit `<file>` → `<skill>`
- User says `<phrase>` → `<skill>`
- About to run `<command>` → `<skill>`

For each MANDATORY-triggered skill in enabled plugins: confirm pointer in CLAUDE.md OR generic-enough to auto-fire. Flag any with zero pointer.

### Phase 7 — Plugin set audit

1. Repo actually uses each enabled plugin's skills? grep references
2. Redundant plugins?
3. Missing plugins (e.g. `dev:debugging` on code-writing repo)?
4. Workspace `.claude/settings.json`: dispatched worker should almost NEVER have `human-collaboration:human-loop` (diagnostic-mode-on-question deadlocks worker)

### Phase 8 — Global surface

`~/.claude/CLAUDE.md` loads EVERYWHERE. Apply Phases 2-4. Common waste:
- Personal-package publish tables → skillify
- Machine-specific paths in always-on rule → triggered global skill
- Plugin/marketplace location: KEEP (meta-rule)

`~/.claude/settings.json` hooks firing every session but only repo-specific → flag.

`~/.claude/agents/*.md` generic → move to plugin so other machines benefit.

## Report format

1. **Token spend snapshot** — `<file>: <lines> ≈ <tokens>`, sum at bottom
2. **Top 5 wins** — `[<savings>] <description> → <action>`
3. **Bloat findings** (Phase 2)
4. **Duplication findings** (Phase 3)
5. **Machine-ref findings** (Phase 4)
6. **Dead pointers** (Phase 5)
7. **Missing skill triggers** (Phase 6)
8. **Plugin set delta** (Phase 7)
9. **Global surface findings** (Phase 8)
10. **Migration plan** — ordered, effort/risk per step

End: "Pick which findings to execute. I will NOT apply any fix without per-finding approval."

## After the user picks targets — file cards

The punch list is approval scratch, not the durable record. Once the user picks targets to execute, file them as tracker card(s) before doing the work (card-first rule, `pipeline:pipe-plan`) — one card per target, or an Epic + phase children when several are related. The audit report itself is never the home of the work; the cards are. (Exception: the user explicitly says to just fix inline without cards.)

## Hard rules

- Read-only. NEVER edit in this invocation.
- No "obviously fine" exemption — ≥80% duplication = flag, don't pre-decide.
- Distinguish illustrative from operational paths.
- Surface global findings even when scope is repo — `~/.claude/` affects this session.
- Quote, don't paraphrase — first 1-2 lines verbatim.
- Respect plugin source-of-truth — recommend plugin edit not repo-local copy.

## Example output

```
Token spend: 36k always-loaded
Top 5 wins:
1. [~5k] CLAUDE.md duplicates Trello-bg in agent-dispatch.md → trim CLAUDE.md
2. [~3k] settings-file.md schema → <plugin>:settings-deep skillify
3. [~2k] production-access.md duplicates prod-access plugin → delete
4. [~1k] 4 rules reference deleted host-mode-interactive.md → repoint
5. [~700/session globally] @thehammer publish in ~/.claude/CLAUDE.md → skillify

Pick targets to execute.
```

## When NOT to use

- Active feature dev (use housekeeping turns)
- Repo <1k always-loaded tokens (no payoff)
- Code-quality reviews (use `caveman:caveman-review` / `code-review:code-review`)
