// [F41 plan §5.1 + §2 PrimaryActions] -> [R2 §5.2] REDESIGNED connection panel.
//
// WHAT THIS FILE WAS. A `<header className="mb-6">` carrying a 2xl app-title
// repeat, four status chips, three full-size buttons, four banners and an
// egress row - roughly the first 150px of the viewport before any real content.
// The operator's screenshot shows exactly that: "a large opaque sidebar, a
// dense top status strip, two connection buttons near the top-right, a
// substantial unused vertical area before the content".
//
// WHAT IT IS NOW. One glass Panel holding the connection workflow, with the
// technical launch detail (cert / nla / credssp / cmdkey) folded into a
// `<details>` disclosure. The reserved vertical space is gone because the
// duplicated identity row is GONE - not because a negative margin hides it.
//
// PRESERVED BY CONSTRUCTION: every F38 regression id this file owned
// (#btnWinAuto, #btnWebDesk, #btnFixReconnect, #rdpFqdn, #nrCert, #nrNla,
// #nrCredssp, #nr*Reason, #winAutoNote, #autoLoginStatus, #recoveryRow,
// #connBanner, #egressLine, #endedBanner, #f94.*, #f95.*), the EXISTING
// handlers (fireAutoLogin / fireFixReconnect / openWebDesktop), and the F94
// §3.3 rule that a disabled button must name the gate that disabled it.
// A closed <details> keeps its children in the DOM, so the 219-id lock
// (src/tests/smoke/ids-regression.test.tsx) still sees every one of them.
import { useState } from "react";
import { AlertTriangle, ChevronRight, ExternalLink, Globe, Monitor, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { Button } from "@/components/primitives/Button";
import { Chip, StatusDot } from "@/components/primitives/Chip";
import { CopyLink } from "@/components/primitives/Copy";
import { Panel } from "@/components/overview/Panel";
import { cn } from "@/lib/cn";
import { FQDN_RE } from "@/lib/format";
import { remainingTime } from "@/lib/domain/metrics";
import { SESSION_WINDOW_MS } from "@/lib/format";
import { credsspChip, recoveryDecision, validFqdnUser, validWebdeskUrl } from "@/lib/domain/native";
import { openWebDesktop } from "@/lib/openWebDesktop";
import { readManualWebDesktop, setManualWebDesktop } from "@/lib/launchUrl";
import { useConnectionVerdict } from "@/hooks/useConnectionVerdict";
import { connTone } from "@/lib/overview/readiness";
import { useNow } from "@/lib/useNow";

export function PrimaryActions({
  verdict: verdictProp,
}: {
  /** Injected by <Overview />; falls back to the store-derived verdict so this
   *  component still works when mounted on its own (the F106 Feature Lab). */
  verdict?: ReturnType<typeof useConnectionVerdict>;
}) {
  const { t } = useTranslation();
  const derived = useConnectionVerdict();
  const verdict = verdictProp ?? derived;

  const native = useSessionStore((s) => s.native);
  const nativeLost = useSessionStore((s) => s.nativeLost);
  const fqdn = useSessionStore((s) => s.fqdn);
  const user = useSessionStore((s) => s.user);
  const listenerOkFlag = useSessionStore((s) => s.listenerOkFlag);
  const runnerDnsOk = useSessionStore((s) => s.runnerDnsOk);
  const autoLogin = useSessionStore((s) => s.autoLogin);
  const fireAutoLogin = useSessionStore((s) => s.fireAutoLogin);
  const fireFixReconnect = useSessionStore((s) => s.fireFixReconnect);
  const progress = useTelemetryStore((s) => s.progress);
  const runStartedAtMs = useTelemetryStore((s) => s.runStartedAtMs);
  const sessionEndMs = useTelemetryStore((s) => s.sessionEndMs);
  const sessionExpired = useTelemetryStore((s) => s.sessionExpired);
  const setSessionExpired = useTelemetryStore((s) => s.setSessionExpired);
  const [webdeskBlocked, setWebdeskBlocked] = useState("");
  const [manualAsserted, setManualAsserted] = useState(() => readManualWebDesktop());
  useNow(1000);

  const s = native || {};
  const rl = s.rdpListener || null;
  const probeReasons = s.probeReasons || {};
  const credOkLocal = validFqdnUser(fqdn, user);

  const certBound = !!s.certBound;
  const nlaOn = !!s.nlaOn;
  const cs = credsspChip(rl);
  const certDays = certDaysRemaining(s.certNotAfter);
  const certTone = certDays == null ? "neutral" : certDays < 7 ? "danger" : certDays < 30 ? "warning" : "success";

  const webdeskUrl = validWebdeskUrl(s.webdeskUrl);

  // Auto-login gate: valid fqdn+user AND listener all green AND runner DNS ok.
  const autoOk = credOkLocal && listenerOkFlag && runnerDnsOk;
  const autoNote = autoOk
    ? "fullscreen native mstsc via one-time ticket; Windows prompts for your password (cmdkey) only if redemption fails"
    : !runnerDnsOk
      ? "Runner DNS broken"
      : credOkLocal
        ? "RDP LISTENER probe not all green (listening/fw/cert/nla) - fix the failed field in the RDP LISTENER row; AUTO-LOGIN stays disabled"
        : "fullscreen native mstsc via one-time ticket; Windows prompts for your password (cmdkey) only if redemption fails";

  // [F94 §3.3] A disabled <button> swallows its click entirely - no hover, no
  // tooltip, no toast. Every failing gate is named here, in the tooltip AND on
  // the page, so a dead button always says which gate killed it.
  const autoBlockers: string[] = [];
  if (!credOkLocal) autoBlockers.push(t("autoLoginBlocked.credentials"));
  if (!runnerDnsOk) autoBlockers.push(t("autoLoginBlocked.dns"));
  if (!listenerOkFlag) autoBlockers.push(t("autoLoginBlocked.listener"));
  const autoWhy = autoBlockers.join("; ");
  const autoTitle = autoOk ? autoNote : t("autoLoginBlocked.title") + " " + autoWhy;

  // Session-expired banner (F34 window).
  if (runStartedAtMs || sessionEndMs) {
    const expired = remainingSec({ sessionEndMs, runStartedAtMs }, Date.now()) <= 0;
    if (expired !== sessionExpired) setSessionExpired(expired);
  }

  const rec = recoveryDecision((rl && rl.authLast) || null, s.handlerChain || [], Date.now());
  const fixVisible = rec.show;
  const fixEnabled = validFqdnUser(fqdn, user);
  const egressIp = s.runnerEgressIp || progress?.runnerEgressIp || "";

  return (
    <Panel
      as="section"
      title={t("overview.connect.title")}
      data-testid="overview-connect-panel"
      className="mb-3"
      actions={
        <Chip id="overview-conn-badge" tone={connTone(verdict.state)} dot title={verdict.evidence}>
          {t(verdict.labelKey)}
        </Chip>
      }
    >
      {/* --- the two actions: one primary, one secondary ------------------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="flex flex-1 flex-col gap-1.5">
          <Button
            data-testid="overview-auto-login"
            id="btnWinAuto"
            variant="primary"
            size="lg"
            className="min-h-[44px] justify-center"
            disabled={!autoOk}
            aria-disabled={!autoOk}
            icon={<Monitor className="size-4" aria-hidden />}
            onClick={() => void fireAutoLogin()}
            title={autoTitle}
            data-why={autoWhy || undefined}
          >
            {t("actions.autoLogin")}
          </Button>
          <span id="winAutoNote" data-testid="overview-auto-login-note" className="text-xs text-tertiary">
            {autoLogin.note || (autoOk ? t("overview.connect.autoHelp") : t("autoLoginBlocked.title") + " " + autoWhy)}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <Button
            data-testid="overview-web-desktop"
            id="btnWebDesk"
            variant="outline"
            size="lg"
            className="min-h-[44px] justify-center"
            disabled={!webdeskUrl}
            icon={<Globe className="size-4" aria-hidden />}
            onClick={() => {
              if (!webdeskUrl) return;
              // [F94 §3.2] openWebDesktop returns {opened}; a null popup return
              // is surfaced instead of being discarded.
              const out = openWebDesktop(webdeskUrl);
              setWebdeskBlocked(!out.opened ? webdeskUrl : "");
            }}
            title={webdeskUrl || t("logonGate.noUrl")}
          >
            {t("actions.webDesktop")}
          </Button>
          <span id="overview-webdesk-note" className="text-xs text-tertiary">
            {webdeskUrl ? t("overview.connect.webHelp") : t("overview.connect.webUnavailable")}
          </span>
        </div>
      </div>

      {/* --- honest state + the evidence that produced it ------------------ */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Chip id="rdpFqdn" mono tone={FQDN_RE.test(fqdn) ? "accent" : "danger"} title={t("overview.connect.fqdnTitle")}>
          {fqdn || t("overview.connect.fqdnUnset")}
        </Chip>
        <span id="autoLoginStatus" className="text-xs text-tertiary">
          {autoLogin.helloSeen ? t("overview.connect.beaconSeen") : ""}
        </span>
      </div>
      <p
        id="overview-conn-evidence"
        data-testid="overview-conn-evidence"
        data-state={verdict.state}
        data-evidenced={verdict.evidenced ? "1" : "0"}
        className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-xs text-secondary"
      >
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
          {t("overview.connect.evidence")}
        </span>
        <span>{verdict.evidence}</span>
      </p>

      {/* [F95 §3.3 / R3] ALWAYS-VISIBLE manual WEB DESKTOP assertion. Not gated
          on the popup having been blocked: the operator may have reached noVNC
          through a bookmark, a second monitor or a plain reload. */}
      <div
        id="f95.viewingModeToggle"
        data-testid="viewing-mode-toggle"
        className="mt-2 flex flex-wrap items-center gap-2"
      >
        <span className="text-xs text-tertiary">{t("viewingMode.manual.prefix")}</span>
        <button
          type="button"
          id="f95.viewingModeToggleBtn"
          data-testid="viewing-mode-toggle-btn"
          aria-pressed={!!manualAsserted}
          onClick={() => {
            const stamp = setManualWebDesktop(!manualAsserted);
            setManualAsserted(stamp);
          }}
          className={cn(
            "min-h-[32px] rounded-md border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            manualAsserted
              ? "border-accent/60 bg-accent/10 text-accent"
              : "border-default text-secondary hover:bg-raised"
          )}
        >
          {manualAsserted ? t("viewingMode.manual.on") : t("viewingMode.manual.off")}
        </button>
        {manualAsserted ? (
          <span id="f95.viewingModeManualStamp" data-testid="viewing-mode-manual-stamp" className="text-xs text-tertiary">
            {t("viewingMode.manual.since")} {new Date(Number(manualAsserted)).toLocaleTimeString()}
          </span>
        ) : (
          <span className="text-xs text-tertiary">{t("viewingMode.manual.hint")}</span>
        )}
      </div>

      {/* [F94 §3.2] Popup-blocked fallback for the WEB DESKTOP button. */}
      {webdeskBlocked ? (
        <div
          id="f94.webdeskBlocked"
          data-testid="webdesk-blocked"
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
        >
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
          <span className="text-xs font-medium text-warning">{t("webdeskBlocked.title")}</span>
          <span className="text-xs text-secondary">{t("webdeskBlocked.message")}</span>
          <a
            id="f94.webdeskBlockedLink"
            data-testid="webdesk-blocked-link"
            href={webdeskBlocked}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 break-all font-mono text-xs text-accent underline"
          >
            <ExternalLink className="size-3" aria-hidden />
            {webdeskBlocked}
          </a>
          <button
            type="button"
            id="f95.webdeskManual"
            data-testid="webdesk-blocked-manual"
            onClick={() => {
              // [F95 §3.3 / R3] Record the manual assertion; the badge flips to
              // "WEB DESKTOP (manual)" and stays there until withdrawn.
              setManualWebDesktop(true);
              setManualAsserted(readManualWebDesktop());
              setWebdeskBlocked("");
            }}
            className="min-h-[32px] rounded-md border border-accent/60 px-2 text-xs font-medium text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("webdeskBlocked.manualOpened")}
          </button>
          <button
            type="button"
            id="f94.webdeskRetry"
            data-testid="webdesk-blocked-retry"
            onClick={() => setWebdeskBlocked("")}
            className="min-h-[32px] rounded-md border border-default px-2 text-xs text-secondary hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("webdeskBlocked.retry")}
          </button>
        </div>
      ) : null}

      {/* F28 recovery row - only on the correlated wrong-password failure. */}
      <div
        id="recoveryRow"
        className={cn("mt-3 flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-3", fixVisible ? "flex" : "hidden")}
        style={fixVisible ? { display: "flex" } : undefined}
      >
        <span className="text-sm font-semibold text-danger">{t("banners.recoveryTitle")}</span>
        <span id="recoveryText" className="text-xs text-secondary">
          {fixVisible
            ? "Password rejected by the host (wrong-password sub-status 0xC000006A, " +
              (rec.dtSec !== undefined && rec.dtSec >= 0
                ? rec.dtSec + "s after the last mstsc launch"
                : rec.dtSec !== undefined
                  ? Math.abs(rec.dtSec) + "s before the last mstsc launch"
                  : "") +
              "). One click re-issues a fresh ticket and overwrites the stored credential - no typing, no clipboard."
            : ""}
        </span>
        <span id="recoveryNote" className="text-xs text-tertiary">
          {t("banners.recoveryNote")}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <Button
            data-testid="overview-fix-reconnect"
            id="btnFixReconnect"
            variant="danger"
            size="sm"
            disabled={!fixEnabled}
            icon={<RefreshCw className="size-3.5" aria-hidden />}
            onClick={() => void fireFixReconnect()}
          >
            {t("actions.fixReconnect")}
          </Button>
          <code id="recoveryCmdkey" className="rounded border border-default bg-sunken px-2 py-1 font-mono text-xs">
            {"cmdkey /generic:TERMSRV/" + (fqdn || "<fqdn>") + " /user:" + (user || "<user>") + " /pass"}
          </code>
          <CopyLink value={() => "cmdkey /generic:TERMSRV/" + fqdn + " /user:" + user + " /pass"} data-testid="overview-copy-cmdkey" />
        </span>
      </div>

      {/* Banners: connBanner visibility mirrors the v1 lostCount>=2 contract. */}
      <div
        id="connBanner"
        className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
        role="alert"
        style={nativeLost ? undefined : { display: "none" }}
      >
        {t("errors.connLost")}
      </div>
      <div
        id="egressLine"
        className="mt-2 flex items-center gap-2 rounded-md border border-default bg-surface/60 px-3 py-2 text-xs text-secondary"
      >
        <StatusDot tone="accent" />
        {t("egress.line", { ip: egressIp || "..." })}
      </div>
      <div
        id="endedBanner"
        className={cn("mt-2 flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger", sessionExpired ? "" : "hidden")}
      >
        <AlertTriangle className="size-4" aria-hidden />
        {t("banners.ended")}
      </div>

      {/* --- launch detail, folded ----------------------------------------- */}
      <details className="group mt-3 border-t border-default pt-2" data-testid="overview-launch-detail">
        <summary
          className="flex min-h-[36px] cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="overview-launch-detail-summary"
        >
          <ChevronRight className="size-3.5 transition-transform duration-fast group-open:rotate-90" aria-hidden />
          {t("overview.connect.detailSummary")}
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip id="nrCert" tone={certTone} title="RDP-Tcp SSLCertificateSHA1Hash present (from /api/native-status)">
            cert: {certBound ? "yes" : "NO"}
          </Chip>
          <Chip id="nrNla" tone={nlaOn ? "success" : "danger"} title="UserAuthentication == 1 on the RDP-Tcp listener">
            nla: {nlaOn ? "ON" : "OFF"}
          </Chip>
          <Chip
            id="nrCredssp"
            tone={cs.tone === "ok" ? "success" : cs.tone === "warn" ? "warning" : cs.tone === "bad" ? "danger" : "neutral"}
          >
            credssp: {cs.text}
          </Chip>
        </div>
        <div className="mt-1 flex flex-col gap-0.5 text-xs text-tertiary">
          <span id="nrCertReason" className={certBound ? "hidden" : ""}>
            {certBound ? "" : "BLOCKED: " + (probeReasons.cert || "RDP-Tcp SSLCertificateSHA1Hash absent")}
          </span>
          <span id="nrNlaReason" className={nlaOn ? "hidden" : ""}>
            {nlaOn ? "" : "BLOCKED: " + (probeReasons.nla || "UserAuthentication != 1 on the RDP-Tcp listener")}
          </span>
          <span id="nrCredsspReason" className={cs.tone === "ok" ? "hidden" : ""}>
            {cs.tone === "ok"
              ? ""
              : "BLOCKED: " + (rl && rl.credsspLive === "warn" ? "LIVE PROBE WARN: " + (rl.credsspLiveWhy || "") : rl && rl.credsspWhy ? rl.credsspWhy : "")}
          </span>
        </div>
      </details>
    </Panel>
  );
}

/**
 * [R-METRICS / #212] Seconds until the session ends. The server-published
 * `sessionEnd` wins; the 5h30 window is the labelled fallback. When neither
 * exists the session is NOT reported expired - an unknown deadline must not
 * raise a false "session ended" banner.
 */
function remainingSec(args: { sessionEndMs: number | null; runStartedAtMs: number | null }, now: number): number {
  const r = remainingTime({
    sessionEndMs: args.sessionEndMs,
    runStartedAtMs: args.runStartedAtMs,
    nowMs: now,
    policyWindowMs: SESSION_WINDOW_MS,
  });
  return r.seconds == null ? Number.POSITIVE_INFINITY : r.seconds;
}

function certDaysRemaining(notAfter: unknown): number | null {
  if (!notAfter) return null;
  const t = Date.parse(String(notAfter));
  if (isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
}
