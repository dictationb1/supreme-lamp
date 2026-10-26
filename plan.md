1. **Fix API 404 when fetching logs in `jules-repair-bridge.mjs` and workflow:**
   - Add `actions: read` to `permissions` in `.github/workflows/jules-rdp-repair.yml`.
   - Update `fetchTriggerRunLogs` in `scripts/jules-repair-bridge.mjs` to use `gh run view <runId> --log -R "<repo>"` instead of `gh api` to fetch plaintext logs natively.
2. **Fix main module execution check:**
   - Update the script execution condition at the bottom of `scripts/jules-repair-bridge.mjs` to use `process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`, and import `pathToFileURL` from `node:url`.
3. **Verify Changes:**
   - Run `node scripts/validate-workflows.mjs` to ensure the workflow is valid.
   - Run `node --test tests/jules-repair-bridge.test.js` to ensure script logic is intact.
4. **Complete pre-commit steps:**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
5. **Submit the fix via PR.**
