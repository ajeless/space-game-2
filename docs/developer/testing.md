# Testing

**Status:** current  
**Audience:** contributors, reviewers

> Guide to Burn Vector's test suite and what each tier asserts.

## Test pyramid

| Tier | Location | Runner | Purpose |
|---|---|---|---|
| Contract | `tests/contracts.smoke.test.ts` | Vitest | Verify JSON contract shapes don't regress. |
| Unit | `tests/*.test.ts` | Vitest | Cover shared logic, resolver, plot authoring, session, presenters. |
| Property | `tests/resolver_determinism.property.test.ts` | Vitest + fast-check | Assert resolver determinism across many seeds. |
| Browser smoke | `browser-tests/*.spec.ts` | Playwright | End-to-end duel flow through a real browser. |

## Commands

- `npm test` — all Vitest tests.
- `npm run test:coverage` — Vitest + coverage report (HTML in `coverage/`).
- `npm run test:browser:smoke` — Playwright end-to-end; builds the client first.
- `npm run check` — typecheck + all Vitest tests.

## Coverage expectations

- `src/shared/` is held to **85%** on lines, functions, and statements. The branches threshold is set lower (**70%**) because v8 counts every `??` / `||` short-circuit and every defensive `throw` arm as a branch — most of the remaining gap is unreachable paths guarded by the validator layer. The reachable data-driven branches spec review identified (reactor rounding modes, `discretionary_pips_override`, subsystem `offline`, weapon miss, off-arc / out-of-range / unknown-charge mount states) are covered by `tests/shared_branch_coverage.test.ts`; with those tests in place aggregate `src/shared/**` branches sit at ~77%. If you can honestly raise branches further with surgical tests against genuinely reachable logic (e.g. `motion.ts`, `sensing.ts`, `planned_shots.ts` still have headroom), do it and bump the threshold.
- `src/server/` coverage is reported but not thresholded.
- `src/client/` is excluded from unit coverage — DOM integration is exercised by the Playwright smoke suite instead.
- Pure type-declaration modules (`src/shared/network.ts`, `src/shared/resolver/types.ts`) are excluded because they contain no runtime code.

## What the property test asserts

`resolver_determinism.property.test.ts` generates arbitrary string seeds and asserts that running the resolver twice with the same state and plots produces byte-identical output. This matches the project's invariant from `AGENTS.md`:

> Replays and tests should be able to run from self-contained state + plot + seed artifacts.

It runs at `numRuns: 50` to keep CI fast (under ~250ms wall time on a warm machine). If this test ever fails, the fix is in the resolver (or its dependencies), not in the test.

## Writing new tests

- Follow the style in the existing file nearest to what you're testing.
- Prefer tests that describe player-visible behavior over tests that lock implementation details.
- For browser work, extend `browser-tests/helpers.ts` rather than copy-paste harness setup.
