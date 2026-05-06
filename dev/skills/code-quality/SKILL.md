---
name: code-quality
description: 'MANDATORY before every code edit, before proposing solutions, before refactor decisions. Loads SOLID/DRY/Zero-Debt discipline (refactor first, extract abstractions, instance state over param threading, no backwards compat, no fallbacks, comments-are-authoritative) as TodoWrite checklist.'
---

# Code Quality

`SOLID / DRY / Zero-Debt / One-Way / Read-First / 100%-Tests / Flawless`

## CRITICAL: The Mission Is 100% Perfect Quality Code

Cost + time not factors. Every file, method, test must correct—no budget, deadline, "good enough". Never skip work because hard, time-consuming, pre-existing. Never construct reasons avoid work. Never modify reviewer agents or quality gates reduce findings.

## CRITICAL: Always Propose the Ideal Solution — Dev Time Is Never a Valid Trade-off

**Default assumption: aim for the ideal solution every time.** When designing, planning, or proposing an approach, identify the architecturally correct, runtime-efficient, best-practice answer FIRST. Do not pre-filter options by "how much code would this take" or "do we want to touch that other repo." Those are not constraints — they are anxieties.

**Dev time / dev effort is never a reason to pick a worse approach.** "It's faster to inherit the legacy shape," "we'd have to extend the worker," "that means changes in two repos," "this is a one-line shim vs. a real fix" — all forbidden as deciding factors. The cost the user cares about is the cost of *running* the system (latency, memory, tokens, correctness, debuggability, fit-to-purpose), and the cost of *living with* the system (technical debt, future change cost, missed best practices). Initial dev time is sunk the moment it's done; bad architecture compounds forever.

**Legitimate trade-offs you may surface for a user decision:**
- Runtime efficiency vs. correctness (e.g. caching freshness windows)
- Two architecturally clean approaches with different system invariants
- Capability gap that genuinely cannot be filled in scope (third-party limit, hardware constraint)
- Security / auth posture differences

**Forbidden trade-offs (do NOT ask the user, do NOT consider):**
- "Approach A is best but takes longer"
- "Approach B requires changes in another repo we own"
- "Approach C means extending the worker / framework / shared infra"
- "Approach D needs new tests / new types / new abstractions"

When the only difference between two approaches is dev effort, there is no decision to surface — pick the ideal one and execute. Stop only when the trade-off is something the *running system* would experience differently. Anything else is rationalization dressed up as engineering.

**Mechanical check before proposing any approach:** "Is the worse-named option only worse because it's faster to write?" Yes → drop it. Don't even mention it. Propose the ideal one, execute it.

## CRITICAL: Zero Backwards Compatibility

**NEVER introduce backwards compatibility code.** Legacy code hides bugs permanently → corrupted state propagate silently. Breaking better—clear error tells exactly what fix.

**Forbidden patterns:**
- Supporting multiple param names or handling "old format" alongside "new format"
- Fallback logic for old names, data structures, APIs
- Two resolution paths for same concept
- "Temporary" compat code or migration paths keep old code working
- Shims, scanner anchors, stubs exist solely keep old paths working

**Rule:** ONE correct way everything. Fix at source, never add compat layers.

## CRITICAL: Legacy Imports ≠ Legacy Module — Default Is Update, Not Delete

**Module imports symbol being deleted = migration signal, not deletion signal.** Surface coupling to legacy (imports, docstring examples, string fixtures, shaped-for-legacy data flow) does NOT justify deleting module. Justifies **updating** module use new system. **~90% of time right answer = rewrite, not delete.**

Before removing any file because "uses legacy code," answer three questions IN WRITING, in plan, not post-hoc retro:

1. **What capability does this module provide?** One sentence. Can't describe capability without referencing legacy impl → haven't separated two — keep thinking. Example: "gate_analysis computes per-gate bin-edge predictiveness" = capability; "gate_analysis reads SHORT_ENTRY_CONDITIONS from a LadderReversion-shaped strategy" = impl.
2. **Does capability apply to new system?** Yes → **REWRITE** (capability kept, impl migrates). No → **DELETE** justified.
3. **Is deletion scope decision I'm making unilaterally?** Capability used by UI page, Makefile target user uses, test user depends on, any surface outside immediate legacy blast radius → **surface to user before acting.** "Delete legacy" directive NOT blanket auth delete capabilities; auth remove LEGACY IMPL of those capabilities.

**Surface signals indicate UPDATE, not DELETE:**
- Module has consumer still wanted (UI view, nav link, Makefile target user references, documented workflow step)
- Capability has equivalent in new system (new APIs produce same class of data module consumes)
- Module's docstring describes generic function, even if current impl shaped around legacy strategy
- Capability appears in user-facing config (gates columns, signals config, analysis pipeline docs)

**Deletion requires CAPABILITY ITSELF obsolete, not just current impl.** "Imports a deleted function" = migration task. "Feature no longer wanted" = deletion.

**Inconsistency = tell.** Making opposite decisions (delete vs keep) on two modules with same underlying technical problem (e.g. both built on flat oracle when system now produces tier-mode oracle) → pattern-matching surface signals — docstring tone, file name — instead of capability. Stop, name underlying technical problem, apply same decision both.

## CRITICAL: Refactor First — Never Build on Bad Foundation

See DRY or SOLID violation → refactor IMMEDIATELY before building on top. Building on code needing refactor wastes effort—new code needs rewriting when foundation eventually fixed. Do right first time, always, even if significantly longer.

## CRITICAL: Extract Shared Abstractions Before Building Consumers

When 2+ classes need same logic, extract to shared location FIRST before writing either consumer. Read all related classes in domain, identify shared patterns, extract to trait/base class/service, then build consumers. For cross-session work, name shared abstraction explicitly in planning so continuation sessions use instead of reinlining.

## CRITICAL: Use Instance State — Never Thread Parameters

Class method chain shares same data → store as instance state. Passing same context through 3+ method signatures = procedural anti-pattern → inflates signatures, creates null checks, makes refactoring fragile. 3+ methods receive same param → belongs on `$this`.

## CRITICAL: No Wrapper Functions — Composables Directly

Never create wrapper functions around composable calls. Call composables directly from where data interacted with. Function whose body = single composable call = dead weight → adds indirection, violates DRY.

**Exception:** Generic/reusable components (SelectField, DanxButton) cannot import domain composables because don't know context. Must use emits + props.

## CRITICAL: Props and Emits Are a Last Resort

Emits exist only for generic components cannot know domain context. Component can import composable → call directly—not emit event asking parent call it. Props minimum: >4 props suspicious (consolidate into config object or read from composable), >2 emits on specialized components suspicious (component should call composable directly), emits passing through unchanged should be broken + called at source.

## CRITICAL: Scalar Values Live on Parent — Never API Call for Single Values

Never API call fetch scalar value (count, status, flag, name) should already be on loaded model. UI needs value → belongs on parent model as field—loaded with parent, not fetched separately. Field doesn't exist yet → add one (relation counter, computed column, cached attribute, resource field) instead of inventing fetching mechanism.

## CRITICAL: Build It Right — Never Take Shortcuts

Every line code permanent—treat as long-term solution. Search first for existing solutions before building. Follow established patterns (consistency > preference). Build for team—write as if someone else maintains tomorrow. Fast way and right way never same; tempted by "this is simpler" → look up right way instead.

## CRITICAL: Grep Schedulers Before Adding Periodic/Sweep Hooks

Adding any periodic, maintenance, sweep, or cleanup logic → grep existing schedulers FIRST. User suggesting WHERE put hook ≠ authorization skip checking WHETHER work already being done elsewhere.

**Mechanical check before proposing OR accepting any hook location for periodic/sweep logic:**

1. Grep canonical scheduler surface for the framework: cron / scheduler config / `@scheduled` decorators / Laravel `routes/console.php` + `app/Console/Commands/` / Node scheduler libs. Existing entry doing same sweep → wire into it, don't add second hook.
2. Read docblocks + comments on proposed hook target (Resource, Repository, Model, Controller). Often state explicit purity contract ("no side effects") + name canonical sweep location.
3. Grep tests on proposed hook location for purity assertions ("does not write", "does not dispatch", "read-only"). Test asserting purity = hook violates contract; sweep lives elsewhere.

User's location suggestion = location *idea*, not search exemption. "User said put it in X" ≠ "X verified right place + work isn't already done elsewhere." Verify both before implementing.

**Cost ratio:** 30s grep vs ~20 min revert + code-review cycle duplicating an existing scheduler.

## CRITICAL: You Own the Entire Codebase

100% responsible for 100% of code 100% of time, regardless who wrote or when. Problem exists → your problem. No valid excuses: not your code, pre-existing, unrelated to changes, too long, needs too many mocks, separate effort. Cross-session ownership applies: you ARE every previous Claude session. Investigate, explain, own untracked files + stale artifacts.

## CRITICAL: Never Guess — Verify Everything

Before using prop value, component, writing code, read source verify (icon names, types, enums, props, slots, behavior). Before assumptions, verify with actual codebase. Reading file = seconds; fixing wrong guess = minutes wasted. Guessing → broken code, wasted time, lost trust.

## CRITICAL: Read Comments On Methods and Classes Before Editing or Investigating

Comments on class, method, function = authoritative context from whoever last understood code. Exist specifically save next reader (you) from repeating mistake, missing constraint, misreading behavior. **Read before editing code + before asserting what code does.**

Mechanical check — before any Edit to method/class OR any factual claim about behavior:

1. **Open file + read comment block(s) above symbol** — docstring, JSDoc, PHPDoc, Python docstring, C#/Rust `///`, Go doc comment, `/** */`, or plain `// comment` lines immediately preceding declaration.
2. **Read inline comments inside body** marking non-obvious logic, invariants, workarounds, "do not X because Y" warnings.
3. **Read header / file-top comments** on file containing symbol — often describe module-level invariants binding every method inside.
4. **Read comments on callers + any overridden parent** — method overrides interface/base class → contract lives on parent's comment. Comment on caller may state precondition you're about to violate.

**Don't skip comments because:**
- "Name obvious" — names lie; comments don't.
- "Can infer from body" — body shows mechanism; comment shows intent + constraint.
- "Just one-line change" — one-line changes break invariants documented one line above.
- "Comment probably stale" — assume current until proven otherwise. Suspect stale → verify against behavior, update comment in same edit.

Edit or assertion contradicts existing comment → STOP. Either comment stale (update as part of change) or understanding wrong (revise plan). Silent contradiction — changing code so comment becomes lie — = zero-tech-debt violation.

Rule applies equally during investigation: reading code to answer "how does X work" or "why does Y happen" → comments = primary evidence, not decoration.

## CRITICAL: Domain Guides Are Mandatory Reading

Before fixing tests, writing code, explaining behavior in any domain, read relevant domain guide first. Don't infer data models from impl code (guide describes intended design; code shows what IS). Don't fabricate data structures. Skipping guide guarantees wasted time. Mechanical check: "About to work in domain with guide? Read it?" No → stop, read first.

## CRITICAL: Fallbacks Are Bugs — Fail Loud, Never Fail Silent

Fallback = silent bug—system appears work while producing wrong results. Failing good; throwing error tells exactly what's wrong + where. Fallbacks hide problems → corrupted state propagates until debugging 10x harder.

**Decision order:** Throw error (DEFAULT—missing values almost always indicate caller bugs), ask user (cannot determine correctness), use fallback (ONLY when 100% certain default intended AND value truly optional, rare).

**Where fallbacks ALWAYS bugs:** Discriminator fields (`type`, `status`, `kind`), config keys, structural validation, constructor params, type inference (guessing structure from shape).

## CRITICAL: NEVER Edit danx-ui Without Explicit Permission

danx-ui OFF LIMITS unless user explicitly grants permission. Before any change: tell user what + why, wait explicit approval.

## CRITICAL: Production Jobs Must Be Incremental by Default

Before code processing production data, answer: "What happens when runs second time?" Redoes all work → design wrong. Any recurring job, sync, migration, pipeline touching production must be incremental: identify delta mechanism (`updated_at`, auto-increment, sync cursor), store high-water mark after each run, only process new/changed rows, never truncate-and-reload. Test: state expected cost/time of 10th run, not just first. Identical → redesign.

## CRITICAL: Observation Is Not Instruction

User describes problem, reports bug, asks about unexpected behavior → only job investigate + report. Do NOT write code or implement fixes. Present findings, wait explicit direction. Applies even when fix obvious. See `debugging.md` for full decision rules. Design proposals not implementation instructions—confirm approach, wait explicit "go ahead" before coding. Never modify user-authored content without explicit request. Production errors = observations: report findings + options, wait user direction.
