// [R2 §5.1] The Overview's page header.
//
// WHAT CHANGED AND WHY. The old Overview opened with `PrimaryActions`, whose
// first element was a 2xl `<h2>` repeating the app title the sticky TopBar had
// already rendered 14px above, followed by four status chips and three
// full-size buttons. That is the "substantial unused vertical area before the
// content" in the operator's screenshot: ~150px of duplicated identity. The
// reserved space is removed by DELETING the duplicate identity row - not with a
// negative margin or a fixed height, which would only hide the cause.
//
// The header is now one 44px row: page name, the connection state (from the
// shared honest state machine, never from a raw producer flag), and a link to
// the Settings surface that owns theme/clarity. The theme and clarity controls
// deliberately live in Settings (#214 §6: one settings surface, not a second
// copy of the same control in the page header).
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import { Chip } from "@/components/primitives/Chip";
import { useGlassStore } from "@/stores/prefsStore";
import { useVisualQuality } from "@/lib/glass/useVisualQuality";
import { connTone, type ConnVerdict } from "@/lib/overview/readiness";

export function OverviewHeader({ verdict }: { verdict: ConnVerdict }) {
  const { t } = useTranslation();
  const variant = useGlassStore((s) => s.variant);
  const clarity = useGlassStore((s) => s.clarity);
  const { resolved } = useVisualQuality();

  return (
    <header
      data-testid="overview-header"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <h2 className="text-base font-semibold leading-none text-primary">{t("overview.title")}</h2>

      {/* One connection indicator, labelled with the STATE and its evidence.
          The TopBar's per-producer pills stay where they are; this is the
          combined, honest answer. */}
      <Chip
        id="overview-conn-state"
        tone={connTone(verdict.state)}
        dot
        title={verdict.evidence}
      >
        {t(verdict.labelKey)}
      </Chip>

      {/* Clarity is surfaced as a READ-ONLY summary with a link, so the
          operator can see which presentation they are on without a second copy
          of the control. Opaque is named explicitly when it resolved that way,
          including when an accessibility preference forced it. */}
      <Link
        to="/settings"
        data-testid="overview-glass-settings-link"
        id="overview-glass-settings-link"
        className="ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-default px-2.5 text-xs font-medium text-secondary hover:bg-raised hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base"
        title={t("overview.glassSettings.title")}
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        <span data-testid="overview-glass-summary" id="overview-glass-summary">
          {t("overview.glassSettings.summary", {
            quality: t("glass.quality." + resolved),
            variant: t("glass.variant." + variant),
            clarity: Math.round(clarity * 100) + "%",
          })}
        </span>
      </Link>
    </header>
  );
}
