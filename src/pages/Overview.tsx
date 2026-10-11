// [F41 plan §5.1] -> [R2 §5] Overview (/) - the landing route.
//
// THE REDESIGN, IN ONE PARAGRAPH. The old page stacked twelve opaque cards in
// declaration order: PrimaryActions (a 2xl app-title repeat plus three
// full-size buttons), then DiagBundleCard - which its own comment called
// "FIRST thing on Overview on purpose" - then KeysCard (credentials), then
// WebDesktopCard, and only then ConnectionCard. That is the operator's
// screenshot: two connection buttons, a dominant diagnostic-export banner with
// assistant-specific wording, credentials in the primary position, and a large
// block of unused vertical space where the duplicated title used to be. The
// page now opens with a 44px header, then the connection panel, then the four
// workspace actions, then a compact troubleshooting summary and the diagnostic
// export as a secondary strip, then real activity. Everything the old page
// mounted is still mounted - the deep technical cards moved into a labelled
// disclosure at the end and stay reachable, and the 219-id lock still passes
// because a closed <details> keeps its children in the DOM.
//
// NOTHING HERE IS DECORATIVE. Every control calls an existing handler
// (fireAutoLogin, openWebDesktop, runDiag, the diag-bundle export) or navigates
// to an existing route (/files, /search, /sessions, /settings, /keys). No new
// route was invented to fill a grid.
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OverviewHeader } from "@/components/overview/OverviewHeader";
import { WorkspaceGrid } from "@/components/overview/WorkspaceGrid";
import { TroubleshootSummary } from "@/components/overview/TroubleshootSummary";
import { ActivityStrip } from "@/components/overview/ActivityStrip";
import { PrimaryActions } from "@/components/domain/PrimaryActions";
import { DiagBundleCard } from "@/components/domain/DiagBundleCard";
// [F96 §2.2] The compact export strip + at-a-glance subsystem dots.
import { ConnectionCard } from "@/components/domain/ConnectionCard";
import { KeysCard } from "@/components/domain/KeysCard";
import { WebDesktopCard } from "@/components/domain/WebDesktopCard";
import { MirrorCard } from "@/components/domain/MirrorCard";
import { LogPanel } from "@/components/domain/LogPanel";
import { DiagnosticsDrawer } from "@/components/domain/DiagnosticsDrawer";
import { TelescopeTimeline } from "@/components/domain/TelescopeTimeline";
import { LauncherBeaconViewer } from "@/components/domain/LauncherBeaconViewer";
import { InstallGuide } from "@/components/domain/InstallGuide";
import { ManualVerifyDrawer } from "@/components/domain/ManualVerifyDrawer";
import { useConnectionVerdict } from "@/hooks/useConnectionVerdict";
import { deriveIssues } from "@/lib/overview/issues";
import { useSessionStore } from "@/stores/sessionStore";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { logonRowText } from "@/lib/domain/native";
import { useNow } from "@/lib/useNow";

function SinhalaSample() {
  return (
    <p id="sinhalaSample" lang="si" className="max-w-shell mx-auto px-4 pb-6 text-xs text-tertiary">
      සිංහල සහය: මෙම පාලක පුවරුව සිංහල අකුරු නිවැරදිව පෙන්වයි (Noto Sans Sinhala අකුරු සමඟ).
    </p>
  );
}

export default function Overview() {
  const { t } = useTranslation();
  useNow(1000);
  const verdict = useConnectionVerdict();

  // --- the inputs the issue list is derived from (all live store state) ----
  const native = useSessionStore((s) => s.native);
  const nativeLost = useSessionStore((s) => s.nativeLost);
  const progressLost = useTelemetryStore((s) => s.progressLost);
  const wsLive = useTelemetryStore((s) => s.wsLive);
  const wsAvailable = useTelemetryStore((s) => s.wsAvailable);
  const wsDead = useTelemetryStore((s) => s.wsDead);
  const wsDeadReason = useTelemetryStore((s) => s.wsDeadReason);
  const wsAttempts = useTelemetryStore((s) => s.wsAttempts);
  const wsLastDisconnectAt = useTelemetryStore((s) => s.wsLastDisconnectAt);
  const sessionExpired = useTelemetryStore((s) => s.sessionExpired);
  const serverNow = useTelemetryStore((s) => s.serverNow);
  const nowMs = serverNow();

  const s = native || {};
  const rl = s.rdpListener || null;
  const row = logonRowText((rl && rl.authLast) || null, rl?.logonCollector || s.logonCollector || null, nowMs);
  const scanMs = row.scanTs ? Date.parse(row.scanTs) : NaN;

  const issues = deriveIssues({
    progressLost,
    wsLive,
    wsAvailable,
    wsDead,
    wsDeadReason,
    wsAttempts,
    wsLastDisconnectAtMs: wsLastDisconnectAt,
    serverNowMs: nowMs,
    nativeLost,
    collectorDead: !!row.dead,
    authScanTsMs: Number.isFinite(scanMs) ? scanMs : null,
    connState: verdict.state,
    connBlockers: verdict.blockers,
    sessionExpired,
  });

  return (
    <div data-testid="overview-page">
      {/* 1. compact identity + the honest connection state */}
      <OverviewHeader verdict={verdict} />

      {/* 2. the connection workflow, immediately below the header */}
      <PrimaryActions verdict={verdict} />

      {/* 3. the four things the operator actually does */}
      <WorkspaceGrid />

      {/* 4. actionable issues, short summary first */}
      <TroubleshootSummary issues={issues} nowMs={nowMs} />

      {/* 5. the export, demoted to a compact secondary strip */}
      <DiagBundleCard />

      {/* 6. real activity, no fabricated figures */}
      <ActivityStrip />

      {/* 7. deep technical detail, disclosed on demand. These are the cards
          that used to occupy the primary screen: credentials, deployment
          text, the raw connectivity rows, the log tail. All still mounted -
          a closed <details> keeps its children in the DOM, so the 219-id
          regression lock and every data-testid gate still see them. */}
      <details className="group mb-6" data-testid="overview-advanced">
        <summary
          data-testid="overview-advanced-summary"
          className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 rounded-md border border-default px-3 text-sm font-medium text-secondary hover:bg-raised hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronRight className="size-4 transition-transform duration-fast group-open:rotate-90" aria-hidden />
          {t("overview.advanced.summary")}
          <span className="text-xs text-tertiary">{t("overview.advanced.hint")}</span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <KeysCard />
          <WebDesktopCard />
          <ConnectionCard />
          <MirrorCard />
          <LogPanel />
          <DiagnosticsDrawer />
          <TelescopeTimeline />
          <LauncherBeaconViewer />
          <InstallGuide />
          <ManualVerifyDrawer />
        </div>
      </details>

      <SinhalaSample />
    </div>
  );
}
