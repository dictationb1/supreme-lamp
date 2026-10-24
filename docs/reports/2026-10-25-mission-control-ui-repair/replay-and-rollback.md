# Replay, reproduce, and roll back

## 1. Reproduce the repaired behaviour from a clean checkout

```bash
git clone https://github.com/dictationb1/supreme-lamp.git
cd supreme-lamp
git checkout af483d2e7771df1055224edf7636518c2d1b61ac   # or the PR #79 merge commit
corepack enable && corepack pnpm install --frozen-lockfile

# the state machine + incident ledger (pure, fast)
pnpm exec vitest run src/tests/smoke/v4-conn-correlation.test.ts

# the screenshot, mounted through the shipped Overview
pnpm exec vitest run src/tests/smoke/v4-incident-ui.test.tsx

# the production PowerShell data contract
node --test tests/f204-logon-correlation.test.js

# the whole gate set
pnpm exec tsc -p tsconfig.build.json --noEmit
pnpm exec vitest run
node --test tests/*.test.js          # needs python3 + pyyaml for the workflow validator
pnpm run build && pnpm run check:no-neon-green && pnpm run check:contrast
```

Expected: 111 vitest files / 1453 tests, 929 `node --test` passes / 0 failures,
tsc clean.

## 2. Reproduce the ORIGINAL defect (regression demonstration)

On the baseline commit `451e8136`, in `src/lib/overview/issues.ts` the failure
issue is created with `observedAtMs: input.serverNowMs` and an unconditional
`cause: { kind: "confirmed", text: "the host rejected the stored credential" }`.
Feed it a 3-hour-old 4625:

```ts
deriveIssues({ ...BASE, connState: "failed", authEventTsMs: Date.now() - 3*3600e3 });
// baseline: observedAtMs === now  -> renders "0s ago"
// now:      observedAtMs === event -> renders "stale (10800s old)"
```

And in `src/lib/overview/readiness.ts`, `deriveConnectionState` on the baseline
returns `failed` for any `authResult === "failed"`, including one whose
`TargetUserName` is another account — there is no `userMatched` input at all.

## 3. Verify on a real Windows host (the step this sandbox cannot do)

```text
Actions → "Windows RDP - Tailscale Mission Control (6h ephemeral)" → Run workflow
  mode          = rdp
  runner_target = windows-latest
```

Then, from the runner's dashboard:

1. `GET /health` → note `ws` and `wsReason`.
2. `GET /api/native-status` → `rdpListener.authLast` must contain
   `recordId`, `targetUser`, `expectedUser`, `userMatched`, `correlation`,
   `remoteInteractive`, `remote`, `session`.
3. Watch `rdp-logon.json` on the runner: `session.name` becomes `rdp-tcp#N`
   when an RDP client connects, and `remoteInteractive` becomes `true` with a
   LogonType-10 logon.
4. Fail a launch deliberately (wrong password in a **disposable** profile) and
   confirm the Overview issue shows the `recordId`, an age measured from the
   event, and `Confirmed` **only** when the account matches `config.rdpUser`.

The lab workflow `.github/workflows/autologin-lab.yml` now executes the same
contract synthetically on Windows (`§V … [V4] CORRELATION CONTRACT`), including
"another account's rejection must not decide this verdict".

## 4. Rollback

The change is confined to one PR; reverting it restores the previous behaviour
without touching any RDP infrastructure.

```bash
# preferred: revert the merge commit on main
git revert -m 1 <merge-commit-of-PR-79>
git push origin main

# or, while unpromoted, just close the PR
gh pr close 79
```

Because the PR does **not** touch the listener, NLA/CredSSP, certificates,
tickets, the launcher or the workflow that provisions the runner, a rollback
cannot break a working RDP connection. The only persistent client-side artefact
is `localStorage["ghrdp:incidentAcks"]` (acknowledgements only); removing it is
harmless:

```js
localStorage.removeItem("ghrdp:incidentAcks");
```

`rdp-logon.json` gains fields; an older client ignores unknown keys, and the
collector rewrites the file on every 30 s scan, so no migration is required.

## 5. Deploying the repaired bytes

The UI is served from the single-file bundle the backend stages, so frontend and
backend must come from the same revision:

1. Merge PR #79.
2. Dispatch `main.yml` on **main** with `mode=rdp`, `runner_target=windows-latest`.
3. Compare the served `/api/version` `sha` with the merge commit — a mismatch
   means an older bundle is being served next to newer backend code (the
   existing stale-bundle check already reports this).
4. Confirm `ui/dist/index.html` in the run's staging step has the hash recorded
   in `manifest.json` for the same source SHA.
