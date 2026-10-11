// [R2 §5.3] Workspace actions - the four things the operator actually does.
//
// NO NEW ROUTES. Files and Transfers both point at the EXISTING `/#/files`
// route, because the transfer queue already renders there in
// `ExplorerProgressRail`; #214 §5 forbids inventing a `/downloads` route to
// make a nav grid look tidy. Search points at `/#/search`, Sessions at
// `/#/sessions`. Every tile is a real `NavLink`, so it is keyboard-reachable
// and announced as a link, not a button that pretends to navigate.
//
// NO FABRICATED METRICS. Each tile's sub-line reads a real store field and
// renders an explicit "nothing yet" when that field is empty - never a sample
// speed, a fake file count or an invented last-run time.
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Folder, Search, ArrowDownToLine, Clock } from "lucide-react";
import GlassContainer from "@/components/primitives/GlassContainer";
import { useSearchStore } from "@/stores/searchStore";
import { useExplorerQueueStore } from "@/lib/explorer/queueStore";
import { activeJobs } from "@/lib/explorer/queue";
import { useSessionStore } from "@/stores/sessionStore";

function Tile({
  to,
  icon,
  label,
  sub,
  testId,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  sub: string;
  testId: string;
}) {
  return (
    <GlassContainer
      as="li"
      surface="nested"
      variant="clear"
      radius="md"
      className="list-none"
    >
      <NavLink
        to={to}
        data-testid={testId}
        className="flex min-h-[76px] items-center gap-3 rounded-md px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-primary">{label}</span>
          <span className="block truncate text-xs text-tertiary" data-testid={testId + "-sub"}>
            {sub}
          </span>
        </span>
      </NavLink>
    </GlassContainer>
  );
}

export function WorkspaceGrid() {
  const { t } = useTranslation();
  // REAL store fields. When they are empty the tile says so.
  const lastQuery = useSearchStore((s) => s.lastSubmittedQuery);
  const resultCount = useSearchStore((s) => s.resultOrder.length);
  const jobs = useExplorerQueueStore((s) => s.jobs);
  const fqdn = useSessionStore((s) => s.fqdn);

  const running = activeJobs(jobs).length;

  return (
    <GlassContainer
      as="section"
      surface="nested"
      variant="tinted"
      radius="lg"
      aria-label={t("overview.workspace.title")}
      data-testid="overview-workspace"
      className="mb-3 p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-primary">{t("overview.workspace.title")}</h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          to="/files"
          icon={<Folder className="size-4" aria-hidden />}
          label={t("nav.files")}
          sub={fqdn ? t("overview.workspace.filesSub", { host: fqdn }) : t("overview.workspace.filesSubNoHost")}
          testId="workspace-files"
        />
        <Tile
          to="/search"
          icon={<Search className="size-4" aria-hidden />}
          label={t("nav.search")}
          sub={
            lastQuery
              ? t("overview.workspace.searchSub", { query: lastQuery, count: resultCount })
              : t("overview.workspace.searchSubEmpty")
          }
          testId="workspace-search"
        />
        <Tile
          to="/files"
          icon={<ArrowDownToLine className="size-4" aria-hidden />}
          label={t("overview.workspace.transfers")}
          // The queue is the real one ExplorerProgressRail renders. "0 active"
          // is a true statement, not a placeholder.
          sub={running > 0 ? t("overview.workspace.transfersActive", { count: running }) : t("overview.workspace.transfersIdle")}
          testId="workspace-transfers"
        />
        <Tile
          to="/sessions"
          icon={<Clock className="size-4" aria-hidden />}
          label={t("nav.sessions")}
          sub={t("overview.workspace.sessionsSub")}
          testId="workspace-sessions"
        />
      </ul>
    </GlassContainer>
  );
}
