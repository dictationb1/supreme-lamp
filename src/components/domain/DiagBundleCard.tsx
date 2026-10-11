// [F96 §2.2/§2.3] -> [R2 §7] DIAGNOSTIC EXPORT + AT-A-GLANCE STRIP.
//
// The operator's constraint, stated in every F93-F95 report: they can paste
// JSON, they cannot paste code or read a log. So one button fetches
// /api/diag/comprehensive, merges the browser half and downloads
// f96-diag-<stamp>.json, next to a compact four-subsystem strip
// (Launcher | Watcher | WS | Logon) that names which one is broken without
// opening anything.
//
// TWO R2 REPAIRS, both visible defects the operator reported:
//
//  1. SURFACE. The root used to be `<div className="glass rounded-xl ...">`.
//     A bare `.glass` class carries no `data-glass-samples` attribute, so
//     NEITHER globals.css selector matched: no backdrop-filter was applied and
//     `--glass-alpha` fell back to 1 - i.e. this card rendered FULLY OPAQUE on
//     every browser, including ones that composite blur perfectly. It is now a
//     `GlassContainer` with `surface="nested"`, so it paints on the shared
//     backdrop like every other card and the translucency is real.
//
//  2. WORDING. The label read "Download Diagnostic Bundle (for Claude)". An
//     assistant-specific name on a product action is wrong regardless of who
//     reads the file: the button exports a diagnostic bundle. It is now
//     "Export diagnostics" (i18n `diagBundle.export`), and the follow-up
//     message says what the file IS rather than who to paste it to.
//
// WEIGHT. It is no longer the visual centre of the Overview - it is a compact
// secondary strip under the troubleshooting summary, with a ghost button.
//
// Copy-only by construction: the button performs exactly one GET and one local
// Blob download. Nothing here executes on the runner, reads a credential, or
// writes server state.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Drawer } from "@/components/primitives/Collapse";
import GlassContainer from "@/components/primitives/GlassContainer";
import { diagAtGlance, downloadDiagBundle, fetchComprehensiveDiag, type DiagBundle, type GlanceColor } from "@/api/diag";

function Dot({ color, id }: { color: GlanceColor; id: string }) {
  const cls =
    color === "green"
      ? "bg-emerald-500"
      : color === "red"
        ? "bg-red-500"
        : "bg-amber-400";
  return <span id={id} data-state={color} className={"inline-block w-2.5 h-2.5 rounded-full " + cls} aria-hidden="true" />;
}

export function DiagBundleCard() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [bundle, setBundle] = useState<DiagBundle | null>(null);
  const [open, setOpen] = useState(false);

  const glance = diagAtGlance(bundle);

  const onDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setToast("");
    const res = await fetchComprehensiveDiag();
    setBusy(false);
    if (!res.ok) {
      setToast(t(res.errorKey));
      return;
    }
    setBundle(res.bundle);
    const name = downloadDiagBundle(res.bundle);
    // The message the operator must be able to act on: WHERE the file went and
    // WHAT to do with it. Never a bare "done".
    setToast(t("diagBundle.downloaded", { file: name }));
  }, [busy, t]);

  return (
    <GlassContainer
      as="section"
      level="card"
      surface="nested"
      radius="lg"
      id="f96.diagBundle"
      aria-label={t("diagBundle.export")}
      data-testid="overview-diag-bundle"
      className="mb-3 p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          data-testid="overview-download-diag"
          id="f96.downloadDiag"
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-secondary hover:bg-raised hover:text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Download size={14} aria-hidden="true" />
          {busy ? t("diagBundle.fetching") : t("diagBundle.export")}
        </button>
        <span className="text-xs text-tertiary">{t("diagBundle.hint")}</span>
      </div>

      {toast ? (
        <p id="f96.diagToast" role="status" className="mt-2 text-xs text-secondary">
          {toast}
        </p>
      ) : null}

      {/* At-a-glance strip: the four subsystems the operator keeps reporting on. */}
      <div id="f96.diagGlance" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Dot color={glance.launcher} id="f96.dotLauncher" />
          <span className="text-secondary">Launcher</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Dot color={glance.watcher} id="f96.dotWatcher" />
          <span className="text-secondary">Watcher</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Dot color={glance.ws} id="f96.dotWs" />
          <span className="text-secondary">WS</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span id="f96.logonValue" className="font-mono text-secondary">
            Logon: {glance.logon}
          </span>
        </span>
        <button
          data-testid="overview-diag-expand"
          id="f96.diagExpand"
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-accent"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          {open ? t("diagBundle.hideDetails") : t("diagBundle.showDetails")}
        </button>
      </div>

      {!bundle && !busy ? (
        <p className="mt-2 text-xs text-tertiary inline-flex items-center gap-1.5">
          <AlertTriangle size={13} aria-hidden="true" />
          {t("diagBundle.notFetched")}
        </p>
      ) : null}

      {open ? (
        <div id="f96.diagDetails" className="mt-3">
          <Drawer id="f96.diagDetailsDrawer" title={t("diagBundle.detailsTitle")} defaultOpen>
            <ul className="flex flex-col gap-1">
              {glance.details.map((d, i) => (
                <li key={i} className="font-mono text-[11px] leading-relaxed break-all text-secondary">
                  {d}
                </li>
              ))}
            </ul>
          </Drawer>
        </div>
      ) : null}
    </GlassContainer>
  );
}
