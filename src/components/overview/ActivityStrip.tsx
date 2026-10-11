// [R2 §5.5] Recent activity + real metrics.
//
// THE RULE THIS FILE IS WRITTEN UNDER: no fabricated activity. There is no
// sample speed, no synthetic FPS, no invented connection history. Each figure
// reads one producer's own field and says "no samples yet" when that producer
// has produced nothing - which is exactly what `Sparkline` already renders for
// an empty sample list, so the empty state is intentional rather than a gap.
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { Panel, Field } from "./Panel";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { useSessionStore } from "@/stores/sessionStore";
import { rttPair, jitterFromSamples, usableSampleCount } from "@/lib/domain/metrics";
import { useNow } from "@/lib/useNow";

/** Same 30s window ConnectionCard uses, so the two surfaces cannot disagree. */
const RTT_MAX_AGE_MS = 30_000;

export function ActivityStrip() {
  const { t } = useTranslation();
  useNow(1000);
  const logLines = useTelemetryStore((s) => s.logLines);
  const httpRtt = useTelemetryStore((s) => s.httpRtt);
  const rttSamples = useTelemetryStore((s) => s.rttSamples);
  const rttAtMs = useTelemetryStore((s) => s.rttAtMs);
  const wire = useTelemetryStore((s) => s.wire);
  const mirror = useTelemetryStore((s) => s.mirror);
  const progress = useTelemetryStore((s) => s.progress);
  const nativeLost = useSessionStore((s) => s.nativeLost);

  // One label per producer (R-METRICS / #211). `jitterFromSamples` returns null
  // until there are two samples, so a single sample cannot render as "stable".
  // The browser HTTP figure and the Tailscale wire figure are DIFFERENT
  // transports and are shown as two labelled rows, never merged.
  const pair = rttPair({
    httpRtt,
    wireRtt: wire && wire.rtt != null ? wire.rtt : null,
    atMs: rttAtMs,
    maxAgeMs: RTT_MAX_AGE_MS,
  });
  const jitter = jitterFromSamples(rttSamples);
  const usable = usableSampleCount(rttSamples);
  const recent = logLines.slice(-4);

  return (
    <Panel
      title={t("overview.activity.title")}
      icon={<Activity className="size-4 text-tertiary" aria-hidden />}
      data-testid="overview-activity"
      className="mb-3"
    >
      <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        <div>
          <Field label={t("overview.activity.httpRtt")}>
            <span className="font-mono" data-testid="activity-http-rtt">
              {pair.http.value == null ? t("overview.activity.noSamples") : pair.http.value + " ms"}
            </span>
            {pair.http.stale ? <span className="text-xs text-warning">{t("overview.activity.stale")}</span> : null}
          </Field>
          <Field label={t("overview.activity.wireRtt")}>
            <span className="font-mono" data-testid="activity-wire-rtt">
              {pair.tailscale.value == null ? t("overview.activity.noSamples") : pair.tailscale.value + " ms"}
            </span>
            {pair.divergent ? (
              <span className="text-xs text-warning" data-testid="activity-rtt-divergent">
                {t("overview.activity.divergent")}
              </span>
            ) : null}
          </Field>
          <Field label={t("overview.activity.jitter")}>
            <span className="font-mono" data-testid="activity-jitter">
              {jitter == null ? t("overview.activity.jitterUnknown") : jitter + " ms"}
            </span>
            <span className="text-xs text-tertiary">
              {t("overview.activity.sampleCount", { n: usable })}
            </span>
          </Field>
          <Field label={t("overview.activity.mirror")}>
            <span data-testid="activity-mirror">
              {mirror && (mirror.files.length > 0 || mirror.pubDot !== "")
                ? t("overview.activity.mirrorOn", { n: mirror.files.length })
                : t("overview.activity.mirrorOff")}
            </span>
          </Field>
          <Field label={t("overview.activity.runnerFeed")}>
            <span data-testid="activity-runner-feed">
              {nativeLost ? t("overview.activity.runnerLost") : progress ? t("overview.activity.runnerLive") : t("overview.activity.runnerPending")}
            </span>
          </Field>
        </div>

        {/* The tail of the REAL log buffer - no synthesised entries. */}
        <div>
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-tertiary">
            {t("overview.activity.recentLog")}
          </h3>
          {recent.length === 0 ? (
            <p className="py-2 text-xs text-tertiary" data-testid="activity-log-empty">
              {t("overview.activity.noLog")}
            </p>
          ) : (
            <ul className="space-y-0.5" data-testid="activity-log">
              {recent.map((line, i) => (
                <li key={i} className="truncate font-mono text-[11px] text-text-mono" title={line}>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
