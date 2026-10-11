// [F41 plan §5.4] Keys & Secrets page: full-width keys card + reveal audit
// note (sensitive: gated). Rotation timestamps come from native-status when
// reported.
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/primitives/Data";
import { KeysCard } from "@/components/domain/KeysCard";
import { useSessionStore } from "@/stores/sessionStore";
import { PageHeader } from "@/components/primitives/PageHeader";

export default function Keys() {
  const { t } = useTranslation();
  const native = useSessionStore((s) => s.native);
  const s = native || {};
  const audit = s.copyAudit || [];
  return (
    <div>
      <PageHeader
        icon={<KeyRound className="size-4" aria-hidden />}
        title={t("pages.keys.title")}
        subtitle={t("pages.keys.purpose")}
        testId="page-keys"
      />
      <KeysCard />
      <Card title="Reveal audit (last 10)" className="mb-4">
        {Array.isArray(audit) && audit.length ? (
          <ul className="text-xs font-mono text-secondary flex flex-col gap-1">
            {audit.slice(-10).map((e: { ts?: string; action?: string }, i: number) => (
              <li key={i}>
                {String(e.ts || "")} {String(e.action || "")}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-tertiary">
            No reveal audit rows are reported by this server build. Copy actions on this page use navigator.clipboard and toast only; no copy events leave the browser
            (F27: secret payloads travel from the authenticated config state to the clipboard, nowhere else).
          </p>
        )}
      </Card>
    </div>
  );
}
