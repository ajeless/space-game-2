# v0.3 — Packaging & Handoff (Burn Vector)

> Design spec for retiring the project into maintenance mode and repackaging it as a portfolio-grade artifact under the product name **Burn Vector**.

**Status:** design — approved for planning
**Created:** 2026-04-24
**Author:** ajeless (with Claude)
**Shipped baseline at spec time:** `v0.2` duel build on top of the unchanged `v0.1` rules/contracts
**Target version:** `v0.3.0`
**Audience for the shipped artifact:** HR and technical hiring managers first; curious junior devs second.

---

## 1. Intent

Retire the project to maintenance mode and ship it as a portfolio piece. "Retire properly, thoroughly, and with love" — not a perfunctory freeze, but also not a renewal of feature ambition. The gameplay scope that exists at v0.2 is what we present; we improve the *presentation* of that scope, not the scope itself.

---

## 2. Confirmed decisions

| Decision | Choice | Rationale |
|---|---|---|
| Product name | **Burn Vector** | Descriptive of the core mechanic (thrust + direction), matches the HUD vocabulary already in the code, doesn't overpromise relative to a two-ship duel, searchable with no major trademark collision. |
| Rebrand scope | Full — repo, package, HTML title, docs references | Portfolio piece needs a coherent brand. |
| Repo/directory rename timing | **After Phase 2 (or 3) ships**, between Claude sessions | Avoids mid-project disruption to remotes, filesystem, and memory paths. |
| Code-change posture | Moderate — PLAN-endorsed extractions only | Honors existing PLAN guidance (split `style.css`, tidy oversized client files) without chasing scope or risking gameplay regression. |
| Hosting | **Static GitHub Pages client + embedded GIF in README** | Pages is free and zero-maintenance; GIF hooks scanners who never click through; live link rewards the curious. |
| Test scope | "C bounded" — polish + coverage on `src/shared/` + one `fast-check` property test | Signals test-craft without flipping test-to-code ratio. |
| Sequencing | Two-phase foundation + presentation, with optional third phase | Product is shippable at each phase boundary; no slice depends on a later one being reached. |

---

## 3. Non-goals

- No gameplay, rules, fixture, or resolver behavior changes.
- No new features promoted from `PLAN.md`'s deferred-work list.
- No dedicated server, AI opponent, hot-seat mode, or campaign work.
- No dependency upgrades or security patches unless one trips the test suite.
- No broad visual/UI redesign of the game itself — Phase 2 visuals are for screenshots, and Phase 3 is markdown docs only.

---

## 4. Phase & slice structure

```
Phase 1 — Foundation (the house before you stage it)
  Slice A — Rebrand & hygiene
  Slice B — Refactor & file-header comments
  Slice C — Test hardening

Phase 2 — Presentation (staging)
  Slice D — Docs pass
  Slice E — Visuals & README (the showpiece)
  Slice F — Demo hosting & cold-read verification

Phase 3 — Optional polish
  Slice G — Markdown visual redesign (applied only after external design guidance)
```

Each slice runs on its own branch, ends with a dedicated commit, and is independently verifiable. If the project stops at the end of Phase 1, the repo is plain-but-competent. If it stops at Phase 2, it is portfolio-grade. Phase 3 is strictly additive.

---

## 5. Phase 1 — Foundation

### 5.1 Slice A — Rebrand & hygiene

**Intent:** flip all in-repo strings from `space_game_2` / `space-game-2` to `Burn Vector` / `burn-vector`, bump the version to `0.3.0`, and clean up internal-only scratch material.

**Deliverables:**
- `package.json` — `name` → `burn-vector`, `version` → `0.3.0`, `description` tightened to a one-line tactical-combat pitch.
- `index.html` — `<title>` → `Burn Vector`.
- `README.md` — title, intro, all `space_game_2` mentions flipped. (Full README rewrite is in Slice E; Slice A only handles naming hygiene.)
- `AGENTS.md` — references flipped; canonical-rule content preserved.
- `PLAN.md` — references flipped; fuller treatment in Slice D.
- `docs/**/*.md` — every occurrence flipped.
- `tests/**/*.ts`, `browser-tests/**/*.ts` — any string fixtures or test descriptions referencing the project name.
- `data/`, `fixtures/` — grep and flip any name references.
- Source-file header references — flipped (but full file-header comments come in Slice B).
- `audit/` directory — **decision point**. Default: `git rm -r audit/` plus add to `.gitignore`. Confirmation from the user required before deletion; alternative is move to `docs/archive/` or leave untouched.
- `CHANGELOG.md` at repo root — Keep-a-Changelog format, three entries (v0.1 / v0.2 / v0.3), structure specified in §8.3.

**Branch:** `v0.3/slice-a-rebrand`

**Exit criteria:**
- `git grep -i "space_game_2"` returns only intentional hits (this spec, commit history, license notices if applicable).
- `npm run check` passes.
- `npm run test:browser:smoke` passes.
- `audit/` disposition is decided and committed.
- `CHANGELOG.md` exists with v0.3 entry marked "in progress".

### 5.2 Slice B — Refactor & file-header comments

**Intent:** perform the PLAN-endorsed modularity cleanup and give every source file a short orientation header.

**Deliverables:**
- **Split `src/client/style.css`** (currently 1,740 lines) into layered files under `src/client/styles/`:
  - Proposed layers: `base.css`, `layout.css`, `tactical.css`, `ssd.css`, `controls.css`, `replay.css`.
  - Actual cut lines decided at slice start by reading the CSS. `style.css` becomes an aggregator that imports the layers (preserving selector order).
- **Extract 1–2 stable seams from `src/client/main.ts`** (currently 960 lines):
  - Candidates: WebSocket lifecycle (connect / reconnect / link-loss), DOM bootstrap/initialization, UI event wiring.
  - Exact extractions confirmed at slice start based on which seams are already cleanest.
- **File-header comments** on every `.ts` and `.css` file under `src/`. Test files (`tests/`, `browser-tests/`) are excluded — their `describe` blocks already serve this role. 3–5 lines per source file, no more. Format:
  1. What this file does (one sentence).
  2. What it depends on / what consumes it (one line).
  3. Any non-obvious invariant (optional; omit if there isn't one).
- No inline per-line narration comments. Project's existing "no comments unless the WHY is non-obvious" rule is respected by scoping comments to module-level orientation only.

**Branch:** `v0.3/slice-b-refactor`

**Exit criteria:**
- `npm run check` passes.
- `npm run test:browser:smoke` passes — **no visual/behavioral regression**. This is the hardest gate; if a regression surfaces, the slice is blocked until resolved.
- `src/client/style.css` is broken into ≥3 files.
- `src/client/main.ts` line count is measurably reduced.
- Every `.ts` and `.css` file in `src/` has a header block.

### 5.3 Slice C — Test hardening

**Intent:** polish existing coverage, add a visible coverage metric on the pure module, and include one property test as a signal of test-craft.

**Deliverables:**
- Gap fill in `src/server/session.ts` tests — reconnect, reclaim, link-loss, race conditions.
- `vitest --coverage` wired via the built-in v8 provider. No extra dependencies.
- Coverage threshold set on `src/shared/` only, at **85% lines and branches**. `src/server/` and `src/client/` are reported but not thresholded.
- One `fast-check` property test on the resolver. Target property: **determinism** — given the same seed and plot, the resolver produces byte-identical output across runs. This matches an invariant the project already claims (AGENTS.md: "Replays and tests should be able to run from self-contained state + plot + seed artifacts").
- `docs/developer/testing.md` — the test pyramid (contract / unit / integration / browser-smoke), the command to run each tier, what the property test asserts and why, the coverage expectations.
- Coverage-badge config prepared (the actual badge embedding happens in Slice E with the rest of the README work).

**Branch:** `v0.3/slice-c-tests`

**Exit criteria:**
- Coverage report runs cleanly; `src/shared/` meets the 85% threshold.
- Property test passes.
- `docs/developer/testing.md` matches reality (commands work when copy-pasted).
- `npm run check` passes.

---

## 6. Phase 2 — Presentation

### 6.1 Slice D — Docs pass

**Intent:** clean the docs of internal slice vocabulary where cold readers would stumble, add an architecture diagram, and formalize the post-retirement framing.

**Deliverables:**
- **External/internal vocabulary split.** Keep "v0.1 / v0.2 slice" vocabulary in `AGENTS.md` and `docs/developer/` — it's accurate and useful for contributors. Soften or replace it in `README.md` and `docs/player/` where cold readers stumble.
- **Architecture diagram** at `docs/design/architecture.md` — Mermaid diagram (renders natively on GitHub) showing:
  - The client / shared / server layer split.
  - The pure-resolver boundary.
  - The Plot → Commit → Execute → Debrief loop.
- **`CONTRIBUTING.md`** at repo root — short, honest: maintenance mode, here's how to clone/run/file-issues. Not actively inviting contributions.
- **Section index READMEs** for `docs/design/`, `docs/developer/`, `docs/player/` — one-paragraph landing pages listing the files and naming their audience.
- **`PLAN.md` post-retirement reframing** (details in §8.2).
- **Correct factual drift** — e.g., `README.md` line 3 references an import date; make sure v0.1/v0.2/v0.3 references agree across the corpus.
- Every file under `docs/` gets a short header block stating *audience* and *status*.

**Branch:** `v0.3/slice-d-docs`

**Exit criteria:**
- Every doc under `docs/` has audience + status header.
- `README.md` routes cold readers through accessible language, not internal slice vocabulary.
- `CONTRIBUTING.md` exists.
- `docs/design/architecture.md` renders on GitHub.

### 6.2 Slice E — Visuals & README (the showpiece)

**Intent:** produce the assets that turn the repo into a portfolio artifact — and rebuild the README around them.

**Deliverables:**
- **Screenshots via Playwright.** Extend the existing browser harness to capture 4 candidate frames at specific moments in a scripted duel:
  1. Bridge at start (SSD + tactical scope side by side).
  2. Mid-turn plotting with handles visible.
  3. Combat replay with a shot in flight or impact.
  4. Post-resolution debrief state.
  Stored under `docs/assets/screenshots/`. The README embeds the best 3 of the 4.
- **Animated GIF.** A ~30-second Playwright video of a full duel turn, converted to GIF via `ffmpeg`. File under `docs/assets/`. Embedded at the very top of the README.
- **Wordmark logo.** SVG treatment of "BURN VECTOR" in a HUD/monospace typeface plus a small vector mark (e.g. a stylized thrust arrow). Lives at `docs/assets/logo/burn-vector-logo.svg`. Legible from favicon scale to banner scale. Possibly also a simplified favicon (`docs/assets/logo/favicon.svg`).
- **`README.md` rebuild** against a clean portfolio template:
  1. Logo + tagline.
  2. Badge row (license, Node engine version, coverage, build-status if applicable).
  3. GIF below the badges — first animated thing a scanner sees.
  4. "What is Burn Vector?" — 3-sentence pitch.
  5. 30-second quickstart — exact commands for clone + install + run.
  6. 3 captioned screenshots showing gameplay progression.
  7. "How it works" — architecture snippet with link to `docs/design/architecture.md`.
  8. Tech stack row — TypeScript, Node.js, Vite, Vitest, Playwright, `ws`, GitHub Pages. Each entry has a logo, credit link, and a one-line "used for X" note.
  9. Inspiration & acknowledgments — the tabletop lineage (Star Fleet Battles, Federation Commander, Attack Vector: Tactical, Full Thrust, Triplanetary, Mayday/Brilliant Lances) with links where available.
  10. "Try it live" link — populated once Slice F deploys, or replaced with a "Run locally" block if Pages falls back.
  11. Status line: "v0.3 — maintenance mode. Feature development is retired; the project stands as a portfolio artifact."
  12. License.
- **Cold-read test #1.** I read the finished README as a first-time reviewer. Note friction, fix inline, iterate until clean.

**Branch:** `v0.3/slice-e-visuals`

**Exit criteria:**
- README has the GIF, screenshots, logo, and tech-stack row with credits.
- All images render correctly on GitHub's renderer (light + dark mode).
- Logo SVG is legible at favicon scale up through banner scale.
- Cold-read produces no further friction notes.

### 6.3 Slice F — Demo hosting & cold-read verification

**Intent:** attempt a static GitHub Pages deploy so a reviewer can see the game move in a browser, or fall back cleanly to the GIF-only story. Also: final cold-read walkthrough and the handoff commit.

**Deliverables:**
- **GitHub Pages deploy — primary target.** Vite config updated for relative asset paths (Pages hosts under `ajeless.github.io/burn-vector/`). GitHub Actions workflow builds the client on push to `main` and publishes to the `gh-pages` branch.
  - **Scope caveat:** the game's multiplayer requires the Node `ws` server, which Pages cannot host. The deployed client alone cannot support real peer play.
  - **Primary demo path:** static deploy that plays a canned duel from an existing `fixtures/` battle, using the existing replay renderer. Reviewers land, see the ship move, see combat animate, get the sense without needing an opponent. Piggybacks on code that already exists.
  - **Fallback:** if the canned-replay-only path requires non-trivial new code, abandon the Pages deploy. README gains a "Run locally" block with clear instructions instead of a "Try it live" link. **Decision made during the slice**, not now.
- **Final rename handoff checklist.** Appended to this spec (§7); referenced from `CONTRIBUTING.md`. No separate handoff document needed.
- **Cold-read test #2 (full).** I pretend to be a junior dev who found the repo from a Google search. Clone, read README, follow quickstart, attempt to run. Log every friction point, fix, re-test.
- **v0.3 handoff commit.** Bumps any remaining version artifacts, stamps the `CHANGELOG.md` v0.3 entry from "in progress" to "shipped", and updates `PLAN.md` status line from "active handoff doc" to "archived — v0.3 retirement complete".

**Branch:** `v0.3/slice-f-deploy`

**Exit criteria:**
- A cold reviewer can understand the project, run it locally in under 3 minutes, and (if Pages worked) see it animate in a browser without cloning.
- `CHANGELOG.md` v0.3 entry is shipped, not in-progress.
- `PLAN.md` status is archived.
- No `space_game_2` string in the tree except in historical locations (commit history, this spec, any license year notice). This is the second grep check after Slice A.

---

## 7. Phase 3 — Optional polish

### 7.1 Slice G — Markdown visual redesign

**Triggered only if:** the user brings back design recommendations from https://claude.ai/design after Phase 2 ships.

**Deliverables:**
- **Triage pass** of the external recommendations against two filters:
  1. *Will GitHub's markdown renderer actually support this?* (Custom HTML: yes. Custom CSS: no. Web fonts: limited. `<details>` collapsibles: yes. Alert blocks `> [!NOTE]` / `> [!TIP]` / `> [!WARNING]`: yes. Mermaid: yes. `<picture>` for light/dark assets: yes.)
  2. *Does it survive the project's "no bloat" ethos?* Skip anything that turns the docs into a maintenance liability.
- **Apply the feasible subset** across `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, and `docs/**/*.md`. Likely motifs: alert/callout blocks, `<details>` collapsibles for long sections, centered images with width hints, cleaned-up badge groupings, consistent section-divider treatment, light/dark banner via `<picture>`.
- **GitHub-renderer verification.** Push to a branch, view every touched page on github.com in both light and dark mode. Fix anything that rendered fine locally but broke on GitHub.
- **Content immutability.** Only presentation changes. If recommendations imply content changes, those get deferred to a separate slice (or discarded).
- **Cold-read test #3.** One more first-time-reviewer pass focused on whether the visual polish helps or gets in the way.

**Branch:** `v0.3/slice-g-markdown-design`

**Exit criteria:**
- Every touched markdown file renders cleanly on GitHub in light + dark mode.
- No content drift versus Phase 2 state.
- Cohesive visual language across the docs (not mixed styles).

**Scope caveat:** Slice G's plan is written *after* the external recommendations are in hand, as a short addendum to the main plan. The main plan can close without Slice G ever running.

---

## 8. Cross-cutting concerns

### 8.1 `audit/` directory disposition

`audit/running_backlog.md` declares itself "local reference only, intended to remain untracked unless explicitly promoted later." The valuable items have already been promoted to `PLAN.md`. Default action at Slice A: `git rm -r audit/` plus add `audit/` to `.gitignore`.

Alternatives held open until Slice A confirms:
- Move contents to `docs/archive/internal-notes/` as archaeology.
- Leave untouched (weakest option — clutters the tree for reviewers).

### 8.2 `PLAN.md` post-retirement framing (applied in Slice D)

- Status line: `active handoff doc` → `archived — v0.3 retirement complete`.
- "Near-term post-v0.2 work" → renamed **"Parked work (not planned)"**, reframed as "if this project ever revived, here's the first mile."
- "Later-slice product direction" and "Research and long-horizon questions" sections retained as-is — they're portfolio-valuable evidence of forward-looking thought.
- "Planning rules" section removed (not relevant after retirement).
- File remains at repo root so inbound links from README keep working.

### 8.3 `CHANGELOG.md` structure

Keep-a-Changelog format, three entries:

- **`[0.3.0] — 2026-MM-DD`** (MM-DD stamped at Slice F shipping):
  - Changed: rebrand to Burn Vector; moved to maintenance mode.
  - Added: playable demo or GIF (depending on Slice F outcome); property test; `TESTING.md`; `CONTRIBUTING.md`; architecture diagram; coverage reporting.
  - Refactored: `style.css` layered split; `main.ts` seam extractions; file-header comments across `src/`.
- **`[0.2.0] — <shipped prior>`:**
  - Changed: combat presentation readability; remote-play reconnect/reclaim/link-loss hardening; replay-locked plotting; host-authenticated match reset.
  - Added: browser regression coverage.
- **`[0.1.0] — <initial playable baseline>`:**
  - Added: peer-hosted networked duel; plot/commit/execute/debrief loop; SSD-centric interface; continuous Newtonian movement; deterministic replay; hull-destruction and boundary-disengagement win conditions.

### 8.4 Acceptance gates at phase boundaries

| Phase boundary | Gate |
|---|---|
| **End of Phase 1** | `npm run check` passes · `npm run test:browser:smoke` passes · `src/shared/` coverage ≥ 85% · `git grep -i space_game_2` returns only intentional hits · file-header comments present on all source files |
| **End of Phase 2** | README renders clean on GitHub · GIF + ≥3 screenshots + logo present · tech-stack row with logos and credits · cold-read test passes · Pages deploy success or documented fallback committed to git history |
| **End of Phase 3** | Every touched markdown file renders cleanly on GitHub in light *and* dark mode · no content drift vs. Phase 2 state · cohesive visual language across docs |

### 8.5 Session-continuity protocol

**Canonical locations:**
- Spec: `docs/superpowers/specs/2026-04-24-v0-3-packaging-and-handoff-design.md` (this file).
- Plan (next step, written by `writing-plans` skill): `docs/superpowers/plans/2026-04-24-v0-3-packaging-and-handoff-plan.md`.
- Memory pointer: an auto-memory entry recording both paths.

**Branch naming:** `v0.3/slice-{a|b|c|d|e|f|g}-<short-name>`
Examples: `v0.3/slice-a-rebrand`, `v0.3/slice-b-refactor`, `v0.3/slice-e-visuals`.

**Commit subject format:** `v0.3 slice X: <what was done>`
Example: `v0.3 slice B: split style.css into layered stylesheets`

**Resumption checklist (run on any cold-start):**
1. Re-read this spec and the plan.
2. `git branch --list 'v0.3/slice-*'` to find active slice branches.
3. `git status` and `git diff` on the in-progress branch to see uncommitted work.
4. `git log --oneline main..HEAD` to see what's already landed on the slice.
5. Open the plan; find the first unchecked `[ ]` whose prerequisites are met; pick up there.
6. If spec and plan disagree, flag to the user before proceeding.

### 8.6 Rename handoff (runs after Phase 2 or Phase 3 ships)

Between Claude sessions, the user runs the following locally:

```bash
# From the existing working directory:
gh repo rename burn-vector        # or rename via the GitHub web UI
cd ~/gitsrc/GitHub
mv space-game-2 burn-vector
cd burn-vector
git remote set-url origin git@github.com:ajeless/burn-vector.git
git fetch origin                  # smoke test: confirms the new URL works
```

GitHub auto-redirects old URLs, so the rename is reversible by running `gh repo rename space-game-2` again. After rename, a new Claude session started from the new directory gets a fresh memory folder under `~/.claude/projects/` — either copy the old folder across, or restart memory fresh and rely on spec + plan + git log for context.

### 8.7 Risk register

| Risk | Mitigation |
|---|---|
| Session drops / compaction mid-slice | Branch + checklist discipline (§8.5); plan has fine-grained `[ ]` checkboxes |
| Refactor regresses v0.2 gameplay (Slice B) | Browser smoke tests are the hard gate at end of Slice B |
| Rebrand misses a stray reference (Slice A / F) | `git grep -i space_game_2` is an explicit exit criterion of Slices A and F |
| GitHub Pages can't host the multiplayer server (Slice F) | Explicit fallback: canned-replay static demo, or GIF-only with "Run locally" block |
| Screenshots drift from final code (Slice E) | Taken only after Phases 1+2 refactor/docs are stable |
| `fast-check` property test flakes (Slice C) | Pick determinism — it's deterministic by contract; skip complex shrinking strategies |
| Dependency version or security drift | Out of scope for v0.3; flagged in `PLAN.md` "parked" section for future |
| Over-scope creep in Slice G | Triage filter gate: GitHub renderer + no-bloat ethos |
| Cold-read friction not caught before shipping | Three cold-read tests (Slice E, Slice F, Slice G) — each simulating a different reader profile |

---

## 9. What this spec deliberately does not decide

- **Exact CSS layer boundaries** in Slice B (decided by reading the CSS at slice start).
- **Which `main.ts` seams** to extract (decided at slice start by inspecting the file).
- **`audit/` final disposition** (confirmed in Slice A with the user).
- **Slice F demo mode** — canned-replay vs GIF-only fallback (decided during Slice F once the implementation cost is clear).
- **Slice G contents** — written as an addendum once external design recommendations are in hand.
- **Exact colors and typography for the wordmark** — assembled in Slice E against the existing visual language of the game.

These are intentional deferrals, not gaps. Deciding them now would require guesses that are better made with the file open.

---

## 10. Definition of "v0.3 shipped"

All of:
- Repo rebranded to `burn-vector`, in-repo and on GitHub.
- `CHANGELOG.md` v0.3 entry is shipped.
- `PLAN.md` is archived.
- README renders as a portfolio-grade cover page with GIF, screenshots, logo, tech stack, acknowledgments, license, status.
- Either live Pages demo is up or documented fallback is in place.
- All acceptance gates at Phase 1 and Phase 2 boundaries pass.
- `npm run check` and `npm run test:browser:smoke` both green.

Phase 3 is not required for shipping. If it runs, its own exit criteria extend the above.
