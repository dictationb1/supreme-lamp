// [R2 §5.1 → V3-01] The Overview's page header.
//
// WHAT CHANGED AND WHY. The old Overview opened with `PrimaryActions`, whose
// first element was a 2xl `<h2>` repeating the app title the sticky TopBar had
// already rendered 14px above, followed by four status chips and three
// full-size buttons. That is the "substantial unused vertical area before the
// content" in the operator's screenshot: ~150px of duplicated identity. The
// reserved space is removed by DELETING the duplicate identity row - not with a
// negative margin or a fixed height, which would only hide the cause.
//
// [V3-01 / D4] The row is now the SHARED PageHeader primitive, so Overview and
// the other ten routes render the same page identity instead of each inventing
// one. Its contract is unchanged: the page name, one honest connection
// indicator, and a read-only summary with a link to the surface that owns
// theme and clarity (#214 §6: one settings surface, not a second copy of the
// control in the page header).
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import { Chip } from "@/components/primitives/Chip";
import { PageHeader } from "@/components/primitives/PageHeader";
import { useGlassStore } from "@/stores/prefsStore";
import { useVisualQuality } from "@/lib/glass/useVisualQuality";
import { connTone, type ConnVerdict } from "@/lib/overview/readiness";

export function OverviewHeader({ verdict }: { verdict: ConnVerdict }) {
  const { t } = useTranslation();
  const variant = useGlassStore((s) => s.variant);
  const clarity = useGlassStore((s) => s.clarity);
  const { resolved } = useVisualQuality();

  return (
    <PageHeader
      testId="overview-header"
      title={t("overview.title")}
      subtitle={t("pages.overview.purpose")}
      status={
        // One connection indicator, labelled with the STATE and its evidence.
        // The TopBar's summary pill stays where it is; this is the combined,
        // honest answer for the page the operator connects from.
        <Chip
          id="overview-conn-state"
          data-testid="overview-conn-state"
          tone={connTone(verdict.state)}
          dot
          title={verdict.evidence}
        >
          {t(verdict.labelKey)}
        </Chip>
      }
      actions={
        // Clarity is surfaced as a READ-ONLY summary with a link, so the
        // operator can see which presentation they are on without a second copy
        // of the control. Opaque is named explicitly when it resolved that way,
        // including when an accessibility preference forced it.
        <Link
          to="/settings"
          data-testid="overview-glass-settings-link"
          id="overview-glass-settings-link"
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-default px-2.5 text-xs font-medium text-secondary hover:bg-raised hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base"
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
      }
    />
  );
}
