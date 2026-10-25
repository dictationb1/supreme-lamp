# Unresolved, blocked, and how to close each one

Nothing in this list is silently "passed". Each row names what is missing, why,
and the exact command/step that closes it.

| # | Item | State | Why | Closes with |
| --- | --- | --- | --- | --- |
| U1 | `mstsc` actually opening a desktop from the dashboard | **NOT RUN** | no Windows host, no tailnet, no operator input in the test environment | Windows candidate run, steps 1–5 of `REPORT-si.md` §7 |
| U2 | "Unknown publisher" dialog cause on the user's PC | **NOT RUN** (mechanism explained, not measured) | requires `%ProgramData%\ghrdp\rdp-signing.json` + the generated `.rdp` on that machine | on the VM: `Get-ChildItem "$env:ProgramData\ghrdp"`, check `rdp-signing.json`, inspect the `.rdp` signature with `Get-AuthenticodeSignature` |
| U3 | cmdkey prompt absent on a replayed ticket | **STRUCT-PASS only** | `ghrdp-rdp-launcher.cs` is not compiled on Linux | PR `main.yml` Windows job compiles `ghrdp-rdp-launcher.exe`; then open an old link twice on the VM |
| U4 | Real RDP listener behaviour under load / NLA probe under a live session | **NOT RUN** | sandbox has no RDP listener | VM run with an active session, `RUN DIAG` |
| U5 | PowerShell route executed for real (both inspect modes) | **STRUCT + client-HTTP only** | no `pwsh` on the test host (`packages.microsoft.com` unreachable) | Windows job of `main.yml` (`mode=readiness`) which starts the server, plus one `POST /api/lab/inspect` per mode |
| U6 | Live `awesome.re` fetch | **NOT RUN** | outbound network from the sandbox is restricted; the allowlist set is proven by contract tests, not by a live fetch | on the VM, Search → `awesome.re` → inspect (`phase=sitemap-ok` expected) |
| U7 | Deployment of this branch to the hosted URL | see `promotion.json` | merge + workflow dispatch are recorded there, not assumed | `gh pr merge` then `gh workflow run main.yml -f mode=rdp -f runner_target=windows-latest` |
| U8 | `replay-viewer` workflow (publishes `docs/` to Pages) | still red (pre-existing) | its publish directory does not exist in the repository; unrelated to this change and not repaired here | separate change that adds the missing `docs/` publish target or moves the workflow's path |
| U9 | Browser external-protocol consent prompt | out of software control | the page cannot read or answer a browser-native dialog | operator answers "Open"; the UI now names this prompt explicitly |

## Deliberately not done (and why)

* No certificate auto-trust, no `-SkipCertificateCheck`, no NLA/TLS relaxation, no
  auto-clicking of Windows dialogs — these would "fix" the symptom by removing a
  security control.
* No wildcard host allowlists for the Search fetcher: the per-source hop set is
  literal and re-checked on every redirect.
* No substitution of a different page for a 404, and no "retry until it works"
  loops for the workflow dispatch.
* No real credentials, tickets, or session data were used; every state-changing
  test ran against in-process fixtures.
