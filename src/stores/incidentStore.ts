// [V4 / 2026-10-25] The incident ledger store.
//
// The ledger itself is the PURE reducer in src/lib/overview/incidents.ts; this
// file is only the browser-lifetime holder plus the acknowledgement write path.
//
// SCOPE IS EXPLICIT AND BROWSER-LOCAL. Acknowledgements are stored in
// localStorage under `ghrdp:incidentAcks` and never sent to the server: another
// browser (or a fresh profile) sees the same incident unacknowledged. That is
// deliberate - an ack is "I have read this", not an operational fact about the
// runner, and pretending otherwise would let one operator hide an incident from
// everyone else.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Issue } from "@/lib/overview/issues";
import {
  EMPTY_INCIDENTS,
  acknowledgeIncident,
  liveIncidents,
  reconcileIncidents,
  resolvedIncidents,
  type IncidentRecord,
  type IncidentState,
} from "@/lib/overview/incidents";

interface IncidentStoreState {
  ledger: IncidentState;
  /** Persisted: keys this browser has acknowledged, with the ack time. */
  acks: Record<string, number>;
  /** Fold one poll of issues in. Idempotent for unchanged event keys. */
  observe: (issues: Issue[], nowMs: number) => void;
  /** Acknowledge / un-acknowledge ONE incident key. Never resolves it. */
  acknowledge: (key: string, atMs?: number) => void;
  /** Test/diagnostics helper: clear the ledger but keep nothing. */
  reset: () => void;
  live: () => IncidentRecord[];
  resolved: () => IncidentRecord[];
}

export const useIncidentStore = create<IncidentStoreState>()(
  persist(
    (set, get) => ({
      ledger: EMPTY_INCIDENTS,
      acks: {},
      observe: (issues, nowMs) =>
        set((st) => {
          const ledger = reconcileIncidents(st.ledger, issues, nowMs);
          // A persisted ack is applied to the ledger, so an acknowledgement
          // survives a reload while the incident is still live.
          const records: Record<string, IncidentRecord> = { ...ledger.records };
          for (const key of Object.keys(records)) {
            const rec = records[key];
            if (rec.resolvedAt == null && st.acks[key] != null && rec.acknowledgedAt == null) {
              records[key] = { ...rec, acknowledgedAt: st.acks[key] };
            }
          }
          return { ledger: { records } };
        }),
      acknowledge: (key, atMs) =>
        set((st) => {
          const now = atMs ?? Date.now();
          const nextAcks = { ...st.acks };
          const wasAcked = nextAcks[key] != null;
          if (wasAcked) delete nextAcks[key];
          else nextAcks[key] = now;
          const ledger = acknowledgeIncident(st.ledger, key, now);
          // acknowledgeIncident toggles; keep the ledger and the persisted set
          // in step for the un-ack direction too.
          const records = { ...ledger.records };
          if (wasAcked && records[key]) records[key] = { ...records[key], acknowledgedAt: null };
          return { acks: nextAcks, ledger: { records } };
        }),
      reset: () => set({ ledger: EMPTY_INCIDENTS, acks: {} }),
      live: () => liveIncidents(get().ledger),
      resolved: () => resolvedIncidents(get().ledger),
    }),
    {
      name: "ghrdp:incidentAcks",
      // Only acknowledgements persist. The ledger is rebuilt from live data on
      // every poll - persisting it would resurrect resolved incidents after a
      // reload and present stale evidence as current.
      partialize: (state) => ({ acks: state.acks }) as unknown as IncidentStoreState,
    }
  )
);
