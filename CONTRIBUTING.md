# Contributing to Burn Vector

> Burn Vector is a **maintenance-mode** project. Active feature development is retired. Issues are welcome; pull requests are accepted on a best-effort basis.

## Running locally

Node.js 24+ required.

```bash
git clone https://github.com/ajeless/burn-vector.git
cd burn-vector
npm install
# In one terminal:
npm run dev:server
# In another:
npm run dev:client
```

Open http://localhost:5173 in two browser tabs to play both sides of a duel.

## Running tests

```bash
npm test                        # Vitest
npm run test:coverage           # Vitest + coverage report
npm run test:browser:smoke      # Playwright end-to-end
npm run check                   # Typecheck + Vitest
```

See [docs/developer/testing.md](./docs/developer/testing.md) for what each tier asserts.

## Filing issues

If you find a real bug — especially something that regresses the v0.2 duel — please open an issue with:

- A minimal repro (browser tab setup, steps to reproduce).
- Expected vs. actual behavior.
- Any console output.

## Scope

See [AGENTS.md](./AGENTS.md) for invariants that cannot change without a contract update. New-feature proposals are unlikely to be accepted; the project stands as a portfolio artifact.

## License

MIT — see [LICENSE](./LICENSE).
