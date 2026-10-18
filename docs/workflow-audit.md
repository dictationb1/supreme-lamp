# Workflow & Dependency Audit Record

## Overview
This document contains the single-source audit for all workflows in `.github/workflows/`, their called scripts, dependencies, source identities, permissions, configuration requirements, and failure incident classifications.

---

## Workflow Inventory & Dependency Graph

| Workflow File | Purpose & Triggers | Required / Optional Dependencies | Called Workflows / Artifacts | Permissions & Approvals |
| --- | --- | --- | --- | --- |
| `.github/workflows/main.yml` | Primary RDP Session & Mission Control (`workflow_dispatch`) | `TS_AUTHKEY` (opt/req for RDP), `VNC_PASS` (opt), UI bundle (`ui-v2.html`), prebuilt binaries (`aria2c`, `qbittorrent-nox`) | `build-ui.yml`, `f59-prebuilt-binaries.yml` | `contents: write` |
| `.github/workflows/replay-viewer.yml` | Replay Viewer & Docs Pages Publisher (`workflow_dispatch`, `push` [fenced], `schedule`) | Docs files (`docs/`), Repo Pages configuration (`has_pages=true`) | Artifact: `github-pages` | `contents: read`, `pages: write`, `id-token: write` |
| `.github/workflows/rdp-lab.yml` | Reusable Lab & Verification (`workflow_dispatch`, `workflow_call`) | Node.js 20, pnpm 9, PowerShell Core, `TS_AUTHKEY` (live profile) | Artifacts: `rdp-lab-evidence-*` | `contents: read` |
| `.github/workflows/jules-rdp-repair.yml` | Event-driven Jules API Repair Bridge (`workflow_run`) | `JULES_API_KEY`, `BRIDGE_ENABLED` | Calls `scripts/jules-repair-bridge.mjs` | `contents: read` |
| `.github/workflows/launch-gates.yml` | CI Safety Gates & Unit Tests (`push`, `pull_request`) | Node.js 20, Python 3, PyYAML | Runs `node --test`, `pnpm test:smoke`, `python3 tests/run-launch-gates.py` | `contents: read` |
| `.github/workflows/build-ui.yml` | UI Build Artifact Producer (`workflow_dispatch`, `workflow_call`) | Node.js 20, pnpm 9 | Artifact: `dist-ui` | `contents: read` |
| `.github/workflows/f59-prebuilt-binaries.yml` | Binary Asset Provisioner (`workflow_dispatch`, `workflow_call`) | Pinned asset hashes in `payloads/f59-prebuilt-pins.json` | Artifact: `f59-prebuilt-binaries` | `contents: read` |
| `.github/workflows/autologin-lab.yml` | Autologin contract verification (`push`, `pull_request`) | `main.yml` structure | Validates `main.yml` contracts | `contents: read` |
| `.github/workflows/provision-warm-runner.yml` | Warm runner provisioning (`workflow_dispatch`) | Azure / VM credentials | Provisions runner environment | `contents: write` |
| `.github/workflows/f60-warm-pins-bootstrap.yml` | F60 warm pins bootstrap (`workflow_dispatch`) | `payloads/f60-warm-pins.json` | Artifact: `f60-pins` | `contents: read` |

---

## Known Incident Classification Audit

| Incident ID | Target Workflow & Run | Evidence Observed | Affected Component | Root Cause Classification | Repair Action | Status |
| --- | --- | --- | --- | --- | --- | --- |
| INC-RDP-21 | `main.yml` #39099640314 (SHA `27cc341c3d87`) | Dashboard readiness returned HTTP 500 repeatedly; Web Desktop 7333 not listening; F92 failed without `/tmp/sr.json`. | Backend (`payloads/ghrdp-server.ps1`), F92 probe | **Code / Exception Handling**: `$null` string substitution / missing property in `ghrdp-server.ps1` outer handler + uncaptured error response in F92 curl. | Added correlation ID (`corrId`) & structured JSON on HTTP 500 in `ghrdp-server.ps1`; sanitized `$null` replacements; refactored F92 probe with elapsed-time deadline & diagnostic writer. | REPAIRED |
| INC-PAGES-137 | `replay-viewer.yml` #39099086550 | `actions/configure-pages@v5` failed with Pages API 404 (`has_pages=false`). | GitHub Pages configuration | **Configuration**: Repository Pages is not enabled or source is not set to `GitHub Actions` in Settings -> Pages. | Updated `replay-viewer.yml` to catch configure-pages 404, display Sinhala operator instruction, make dry-run genuinely non-deploying, and avoid tight retry loops. | REPAIRED |
| INC-BRIDGE-21 | `jules-rdp-repair.yml` #39101112964 | Dispatched `sessions/18437072707914270322`. | Jules Repair Bridge (`scripts/jules-repair-bridge.mjs`) | **Automation / Deduplication**: Ensure bridge reuses active session and prevents duplicate session dispatches. | Verified deduplication in `jules-repair-bridge.mjs` matching run ID and active session mapping. | VERIFIED |
