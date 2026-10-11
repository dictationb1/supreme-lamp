// [R2 §7 → V3-05 / #202 #205] Embedded troubleshooting summary.
//
// SHORT SUMMARY FIRST, TECHNICAL DETAIL ON DEMAND. The panel lists the issues
// in SEVERITY order, each as: what is affected (area), what was observed
// (symptom), which producer observed it and when (source + freshness), and the
// next safe action. "Diagnose" opens the EXISTING embedded drawer
// (sessionStore.diagOpen, rendered by <DiagSideDrawer /> at the App root) - it
// does not navigate away and it does not run anything on the runner.
//
// [V3-05] THE THREE GAPS THIS REWRITE CLOSES.
//   1. ORDER. It rendered `issues.slice(0, 3)` - the first three in PRODUCER
//      order. A critical reachability failure pushed last was therefore cut
//      away by three infos. The list is now sorted by severity (stable within
//      a severity), and the remaining issues are REACHABLE through an explicit
//      toggle instead of being silently dropped.
//   2. ACTIONS. Producers emitted `actionId: "keys"` and `"health"` that the
//      renderer ignored, so the operator read "check the keys" with nothing to
//      click. Every action id a producer can emit now renders a control, and
//      `IssueActionId` is a type so a NEW id is a compile error until the UI
//      honours it.
//   3. DISCLOSURE. The count badge carried the worst severity only in prose;
//      it now publishes it as data so the browser lab can assert it.
//
// THE EXPORT IS SECONDARY. `#f96.downloadDiag` was the visual centre of the old
// Overview and carried assistant-specific wording; it is now a small ghost
// button in the panel footer with the neutral label "Export diagnostics".
//
// READ-ONLY BY DEFAULT. Nothing here mutates files, restarts a service or
// launches a session. The only write is the operator's own Reconnect click.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Stethoscope, AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { Panel } from "./Panel";
import { Button } from "@/components/primitives/Button";
import { useSessionStore } from "@/stores/sessionStore";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { logButtonAction } from "@/lib/collectorAgent";
import { isStale, orderIssues, worstSeverity, type Issue, type Severity } from "@/lib/overview/issues";
import { cn } from "@/lib/cn";

const SEV_ICON: Record<Severity, typeof Info> = {
  critical: OctagonAlert,
  warning: AlertTriangle,
  info: Info,
};

/** How many issues are shown before the operator asks for the rest. */
export const PREVIEW_COUNT = 3;

function IssueRow({ issue, nowMs }: { issue: Issue; nowMs: number }) {
  const { t } = useTranslation();
  const Icon = SEV_ICON[issue.severity];
  const stale = isStale(issue.observedAtMs, nowMs);
  const setDiag = useSessionStore((s) => s.setDiag);
  const runDiag = useSessionStore((s) => s.runDiag);
  const reconnect = useTelemetryStore((s) => s.requestWsReconnect);

  // Handlers are named functions declared OUTSIDE the JSX on purpose. The
  // repo-wide data-testid scanner (tests/f-testid-coverage.test.js, tagExtent)
  // walks an opening tag character by character and does not strip comments, so
  // an apostrophe inside a comment inside a tag opens a string literal and the
  // scanner reads the tag as running to end-of-file. Keeping tag bodies free of
  // comments is what keeps that inventory accurate.
  const onReconnect = () => {
    // The SAME store action the TopBar Reconnect button calls, logged through
    // the same collector action - one write path, not two.
    const start = performance.now();
    reconnect();
    logButtonAction({
      feature: "websocket",
      action: "reconnect",
      params: { origin: "overview-troubleshoot" },
      result: { requested: true },
      elapsedMs: Math.round(performance.now() - start),
    });
  };
  const onDiagnose = () => {
    setDiag(true);
    void runDiag();
  };

  return (
    <li
      data-testid={"issue-row-" + issue.id}
      data-severity={issue.severity}
      data-stale={stale ? "1" : "0"}
      className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-3"
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          issue.severity === "critical" && "bg-danger/15 text-danger",
          issue.severity === "warning" && "bg-warning/15 text-warning",
          issue.severity === "info" && "bg-raised text-secondary"
        )}
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-primary">{t(issue.areaKey)}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
            {t("issues.severity." + issue.severity)}
          </span>
          {/* Freshness, labelled. A stale reading is never shown as current. */}
          <span
            className="text-[11px] text-tertiary"
            data-testid={"issue-freshness-" + issue.id}
            title={issue.source}
          >
            {issue.observedAtMs == null
              ? t("issues.freshness.noTimestamp")
              : stale
                ? t("issues.freshness.stale", { sec: Math.round((nowMs - issue.observedAtMs!) / 1000) })
                : t("issues.freshness.current", { sec: Math.round((nowMs - issue.observedAtMs!) / 1000) })}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-secondary">
          {t(issue.symptomKey, issue.symptomVars as Record<string, string> | undefined)}
        </p>
        {/* Confirmed vs suspected, stated in words. */}
        <p className="mt-0.5 text-xs text-tertiary">
          <span className="font-medium uppercase">
            {issue.cause.kind === "confirmed" ? t("issues.cause.confirmed") : t("issues.cause.suspected")}
          </span>{" "}
          {issue.cause.text}
          <span className="text-tertiary"> · {t("issues.source")}: {issue.source}</span>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-secondary">{t(issue.nextActionKey)}</span>
          {/* [V3-05] EVERY action id a producer can emit renders a control here. */}
          {issue.actionId === "ws-reconnect" ? (
            <button
              type="button"
              data-testid={"issue-action-" + issue.id}
              onClick={onReconnect}
              className="min-h-[32px] rounded-md border border-danger/50 px-2 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t("activity.wsReconnect")}
            </button>
          ) : null}
          {issue.actionId === "diagnose" ? (
            <button
              type="button"
              data-testid={"issue-action-" + issue.id}
              onClick={onDiagnose}
              className="min-h-[32px] rounded-md border border-default px-2 text-xs font-medium text-secondary hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t("overview.troubleshoot.diagnose")}
            </button>
          ) : null}
          {issue.actionId === "keys" ? (
            <Link
              to="/keys"
              data-testid={"issue-action-" + issue.id}
              className="inline-flex min-h-[32px] items-center rounded-md border border-default px-2 text-xs font-medium text-secondary hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t("nav.keys")}
            </Link>
          ) : null}
          {issue.actionId === "health" ? (
            <Link
              to="/health"
              data-testid={"issue-action-" + issue.id}
              className="inline-flex min-h-[32px] items-center rounded-md border border-default px-2 text-xs font-medium text-secondary hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t("pages.health.title")}
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function TroubleshootSummary({ issues, nowMs }: { issues: Issue[]; nowMs: number }) {
  const { t } = useTranslation();
  const setDiag = useSessionStore((s) => s.setDiag);
  const runDiag = useSessionStore((s) => s.runDiag);
  const [showAll, setShowAll] = useState(false);

  // [V3-05] Severity first, producer order preserved inside a severity. The
  // preview is a VIEW over that ordering, never a replacement for it: the rest
  // is one click away, so a critical issue can no longer be hidden by the
  // accident of which subsystem `deriveIssues` checks first.
  const ordered = orderIssues(issues);
  const worst = worstSeverity(ordered);
  const hidden = ordered.length > PREVIEW_COUNT;
  const shown = showAll || !hidden ? ordered : ordered.slice(0, PREVIEW_COUNT);

  return (
    <Panel
      title={t("overview.troubleshoot.title")}
      icon={<Stethoscope className="size-4 text-tertiary" aria-hidden />}
      data-testid="overview-troubleshoot"
      className="mb-3"
      actions={
        <span
          data-testid="overview-issue-count"
          id="overview-issue-count"
          data-worst={worst}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            worst === "critical" ? "bg-danger/15 text-danger" : worst === "warning" ? "bg-warning/15 text-warning" : "bg-raised text-secondary"
          )}
        >
          {issues.length === 0 ? t("overview.troubleshoot.none") : t("overview.troubleshoot.count", { n: issues.length })}
        </span>
      }
    >
      {shown.length === 0 ? (
        <p className="py-1 text-sm text-secondary" data-testid="overview-troubleshoot-empty">
          {t("overview.troubleshoot.allClear")}
        </p>
      ) : (
        <ul data-testid="overview-issue-list" className="divide-y divide-default">
          {shown.map((i) => (
            <IssueRow key={i.id} issue={i} nowMs={nowMs} />
          ))}
        </ul>
      )}

      {/* [V3-05] The reachability control. Hidden issues are one click away
          instead of being dropped by an array slice. */}
      {hidden ? (
        <button
          type="button"
          data-testid="overview-issues-toggle"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-2 min-h-[32px] rounded-md border border-default px-2 text-xs font-medium text-secondary hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {showAll
            ? t("overview.troubleshoot.showFewer")
            : t("overview.troubleshoot.showAll", { n: issues.length })}
        </button>
      ) : null}

      {/* Footer: Diagnose only. The export lives in <DiagBundleCard />, which
          Overview renders directly below this panel as a compact secondary
          strip - one owner for `#f96.downloadDiag`, never two. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-default pt-3">
        <Button
          data-testid="overview-diagnose"
          id="overview-diagnose"
          variant="secondary"
          size="sm"
          icon={<Stethoscope className="size-3.5" aria-hidden />}
          onClick={() => {
            setDiag(true);
            void runDiag();
          }}
        >
          {t("overview.troubleshoot.diagnose")}
        </Button>
      </div>
    </Panel>
  );
}
