// [V3-06 / #194 §7] BuildProvenanceCard — what is actually running, and why
// that is not a guess.
//
// WHY THIS CARD EXISTS. The old WebDesktopCard compared the compiled SHA with
// `main`'s SHA and, when they differed, told the operator the UI was OLDER.
// That inference is not sound: `main` carries status-only commits that change
// no interface, so `built != main` proves nothing about which UI is newer - it
// only proves the branch has moved. Shipping an unsound inference behind a
// warning colour is worse than shipping nothing.
//
// What the operator actually needs is PROVENANCE:
//   * which source revision this bundle was built from (stamped at build time);
//   * which stamp the page currently SERVED carries (read from the DOM, so a
//     stale cached bundle is visible instead of inferred);
//   * whether those two agree - the only comparison that is meaningful;
//   * which artifact it came from;
//   * and, ON REQUEST, what the backend says about its own release.
//
// NOTHING IS FETCHED ON MOUNT. `tests/f70-source-probe.test.tsx` pins that the
// Settings tree performs no network call on render; the backend release is a
// cross-check the operator asks for with an explicit button, not a probe that
// fires because a tree happened to mount.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, RefreshCw } from "lucide-react";
import { Card } from "@/components/primitives/Data";
import { Button } from "@/components/primitives/Button";
import { Chip } from "@/components/primitives/Chip";
import { apiBase } from "@/lib/api";
import { F92_FRONTEND_SHA } from "@/lib/f92";

/** The sha this bundle was built from, stamped by build-ui.yml (VITE_BUILD_SHA). */
export const BUILD_SHA: string =
  (import.meta.env.VITE_BUILD_SHA as string | undefined) ||
  (import.meta.env.VITE_GIT_SHA as string | undefined) ||
  "";

export const BUILD_SHA_SHORT: string = (BUILD_SHA || "dev").slice(0, 7);

/**
 * The stamp the SERVED page carries. Read from `#ghrdpBuild[data-build]` rather
 * than from the module constant, because the module constant can only ever
 * describe the bundle it was compiled into - and the whole point is to detect
 * the case where the browser is running a DIFFERENT (older) one.
 */
function readServedSha(): string {
  if (typeof document === "undefined") return "";
  return document.getElementById("ghrdpBuild")?.getAttribute("data-build") || "";
}

type BackendState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; releaseId: string; version?: string; match: boolean | null }
  | { status: "error"; message: string };

export function BuildProvenanceCard() {
  const { t } = useTranslation();
  const [served, setServed] = useState<string>("");
  const [backend, setBackend] = useState<BackendState>({ status: "idle" });

  // The served stamp is a DOM read, not a fetch: it is available immediately
  // and it cannot fail, which is what makes the served/built comparison cheap
  // enough to show by default.
  useEffect(() => {
    setServed(readServedSha());
  }, []);

  const check = useCallback(async () => {
    setBackend({ status: "checking" });
    try {
      const r = await fetch(
        apiBase() + "/api/f92-selftest?frontendSha=" + encodeURIComponent(F92_FRONTEND_SHA),
        { cache: "no-store" }
      );
      const j = (await r.json()) as { releaseId?: string; version?: string; status?: string };
      const v = j.releaseId || "";
      setBackend({
        status: "ok",
        releaseId: v,
        version: j.version,
        // Only the backend's own release id and THIS bundle's sha are compared.
        // `main`'s head is deliberately not part of the comparison: it says
        // nothing about which interface is running.
        match: v ? v.startsWith(BUILD_SHA.slice(0, 7)) || BUILD_SHA.startsWith(v.slice(0, 7)) : null,
      });
    } catch (e) {
      setBackend({ status: "error", message: String(e) });
    }
  }, []);

  const agrees = served === BUILD_SHA || (served === "" && BUILD_SHA === "");
  const artifact = BUILD_SHA ? "ui-dist-" + BUILD_SHA + ".zip" : t("about.unknown");

  return (
    <Card
      id="about-build-provenance"
      title={t("about.buildServed")}
      icon={<Fingerprint className="size-5 text-accent" aria-hidden />}
      className="mb-4"
      actions={
        <Chip id="about-match-chip" tone={agrees ? "success" : "warning"} mono>
          {agrees ? t("about.servedEqualsBuilt") : t("about.servedDiffersBuilt")}
        </Chip>
      }
    >
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-tertiary">
            {t("about.sourceRev")}
          </dt>
          <dd className="mt-0.5 font-mono text-xs text-text-mono break-all" data-testid="about-source-rev">
            {BUILD_SHA || t("about.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-tertiary">
            served (#ghrdpBuild)
          </dt>
          <dd className="mt-0.5 font-mono text-xs text-text-mono break-all" data-testid="about-served-rev">
            {served || t("about.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-tertiary">
            {t("about.artifact")}
          </dt>
          <dd className="mt-0.5 font-mono text-xs text-text-mono break-all" data-testid="about-artifact">
            {artifact}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-tertiary">
            {t("about.backendRelease")}
          </dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-text-mono" data-testid="about-backend-release">
              {backend.status === "ok"
                ? backend.releaseId || t("about.unknown")
                : backend.status === "error"
                  ? t("about.unknown")
                  : backend.status === "checking"
                    ? "…"
                    : t("about.notChecked")}
            </span>
            {backend.status === "ok" && backend.match != null ? (
              <Chip
                id="about-backend-match"
                tone={backend.match ? "success" : "warning"}
                mono
                data-testid="about-backend-match"
              >
                {backend.match ? "match" : "differs"}
              </Chip>
            ) : null}
            <Button
              data-testid="about-recheck"
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="size-3.5" aria-hidden />}
              onClick={() => void check()}
            >
              {t("about.recheck")}
            </Button>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-tertiary" data-testid="about-hint">
        {t("about.hint")}
      </p>
    </Card>
  );
}

export default BuildProvenanceCard;
