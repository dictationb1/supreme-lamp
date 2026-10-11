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

  // Read-only description of the presentation currently in effect. Computed
  // once because it is needed both as the painted label and as the accessible
  // name of the link, and the two must never disagree.
  const glassSummary = t("overview.glassSettings.summary", {
    quality: t("glass.quality." + resolved),
    variant: t("glass.variant." + variant),
    clarity: Math.round(clarity * 100) + "%",
  });
  const glassTitle = t("overview.glassSettings.title");

  return (
    <PageHeader
      testId="overview-header"
      title={t("overview.title")}
      subtitle={t("pages.overview.purpose")}
      status={
        // One connection indicator, labelled with the STATE and its evidence.
        // The TopBar summary pill stays where it is; this is the combined,
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
        //
        // PHONE WIDTH. The painted summary is withdrawn below `sm` and the link
        // becomes icon-only. This is a layout fix, not a feature removal: at
        // 390px the title, the connection chip and this labelled control did not
        // fit on one row, so the row wrapped and the header grew from 56px to
        // 84px in English and to 100px in Sinhala - over the R2 ceiling of 80px
        // that exists to keep the header from becoming a hero. The English
        // layout had zero slack (the control ended exactly on the right gutter),
        // so any font-metric difference flipped it; Sinhala flipped it always.
        //
        // Nothing is lost. The summary text stays in the DOM for the component
        // gates and for screen readers, and it becomes the link accessible name,
        // so a phone user still hears exactly which presentation is active and
        // still has the same one-tap route to Settings.
        <Link
          to="/settings"
          data-testid="overview-glass-settings-link"
          id="overview-glass-settings-link"
          aria-label={glassTitle + ": " + glassSummary}
          className="inline-flex min-h-[36px] items-center gap-0 rounded-md border border-default px-2 text-xs font-medium text-secondary hover:bg-raised hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base sm:gap-1.5 sm:px-2.5"
          title={glassTitle}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
          <span
            data-testid="overview-glass-summary"
            id="overview-glass-summary"
            className="sr-only whitespace-nowrap sm:not-sr-only"
          >
            {glassSummary}
          </span>
        </Link>
      }
    />
  );
}
