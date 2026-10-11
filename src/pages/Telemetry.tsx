// [F41 plan §5.6] Telemetry page: telescope timeline full-height, launcher
// beacon chain (JSONL) with the logon + Schannel tables.
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/primitives/Data";
import { Tabs } from "@/components/primitives/Collapse";
import { TelescopeTimeline } from "@/components/domain/TelescopeTimeline";
import { LauncherBeaconViewer } from "@/components/domain/LauncherBeaconViewer";
import { LogonEventsTable, SchannelTable, BeaconJsonlViewer } from "@/components/domain/LogPanel";
import { PageHeader } from "@/components/primitives/PageHeader";

export default function Telemetry() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader
        icon={<Zap className="size-4" aria-hidden />}
        title={t("pages.telemetryPage.title")}
        subtitle={t("pages.telemetryPage.purpose")}
        testId="page-telemetry"
      />

      <Card title={t("telescope.title")} className="mb-4">
        <TelescopeTimeline />
      </Card>

      <Tabs
        label={t("logs.title")}
        tabs={[
          { id: "logon", label: t("logs.logonEvents"), content: <LogonEventsTable maxHeight="max-h-[480px]" /> },
          { id: "schannel", label: t("logs.schannel"), content: <SchannelTable maxHeight="max-h-[480px]" /> },
          { id: "launcher", label: t("logs.launcher"), content: <BeaconJsonlViewer /> },
        ]}
      />

      <div className="mt-4">
        <LauncherBeaconViewer />
      </div>
    </div>
  );
}
