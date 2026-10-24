// [V4 / 2026-10-25] Incident lifecycle: identity, age and resolution.
//
// THE DEFECT THIS REPLACES. Issues were recomputed from scratch on every poll
// and dated with `serverNowMs`, so:
//   * one 4625 produced a "new" issue every second - the browser could not
//     tell a repeated observation from a fresh event, and the rendered age
//     ("0s ago") reset on every render;
//   * an incident that stopped being reported silently vanished with no
//     resolution time, so an operator could not tell "fixed" from "never seen";
//   * acknowledging (this operator has read it) and resolving (the producer no
//     longer reports it) were the same non-action: neither existed.
//
// The reducer below is pure. It keys on `Issue.incidentKey`, which the producer
// derives from the EVENT (Windows record id, else event timestamp), never from
// the render. Therefore:
//   * repeated polls of ONE event keep its original occurredAt/firstObserved;
//   * a NEW event produces a NEW record, and the old one becomes history;
//   * a record disappears from the live set only when the producer stops
//     reporting that key, and that moment is stamped as resolvedAt.
import type { Issue, Severity } from "./issues";

export interface IncidentRecord {
  key: string;
  /** The production line that emitted it (stable across record identity). */
  id: string;
  severity: Severity;
  /** When the underlying EVENT happened (null when the producer had no time). */
  occurredAtMs: number | null;
  /** First time THIS browser observed it - never reset by a later poll. */
  firstObservedAtMs: number;
  /** Last time this browser re-observed the same event. */
  lastObservedAtMs: number;
  /** When the producer stopped reporting it. null while still live. */
  resolvedAt: number | null;
  /** When the operator acknowledged it. Independent of resolvedAt. */
  acknowledgedAt: number | null;
  /** How many polls observed it. Diagnostics only. */
  observations: number;
  /** Snapshot of the most recent issue payload for rendering. */
  issue: Issue;
}

export interface IncidentState {
  records: Record<string, IncidentRecord>;
}

/** Bound on resolved history kept in memory, newest first. */
export const MAX_RESOLVED_HISTORY = 50;

export const EMPTY_INCIDENTS: IncidentState = { records: {} };

/**
 * Fold one poll's issues into the incident ledger.
 *
 * `nowMs` must be the SAME clock the caller used to build the issues; the
 * ledger never mixes clocks. `occurredAtMs` always comes from the issue.
 */
export function reconcileIncidents(prev: IncidentState, issues: Issue[], nowMs: number): IncidentState {
  const records: Record<string, IncidentRecord> = { ...prev.records };
  const seen = new Set<string>();

  for (const issue of issues) {
    const key = issue.incidentKey || issue.id;
    seen.add(key);
    const existing = records[key];
    if (existing) {
      records[key] = {
        ...existing,
        // The event's own time is authoritative; a re-poll must never move it.
        occurredAtMs: existing.occurredAtMs ?? issue.occurredAtMs,
        lastObservedAtMs: nowMs,
        resolvedAt: null,
        observations: existing.observations + 1,
        severity: issue.severity,
        id: issue.id,
        issue,
      };
    } else {
      records[key] = {
        key,
        id: issue.id,
        severity: issue.severity,
        occurredAtMs: issue.occurredAtMs,
        firstObservedAtMs: nowMs,
        lastObservedAtMs: nowMs,
        resolvedAt: null,
        acknowledgedAt: null,
        observations: 1,
        issue,
      };
    }
  }

  // Anything the producer stopped reporting is resolved NOW - once. A record
  // already resolved keeps its original resolvedAt (a later poll cannot move
  // history either).
  for (const key of Object.keys(records)) {
    if (seen.has(key)) continue;
    if (records[key].resolvedAt == null) {
      records[key] = { ...records[key], resolvedAt: nowMs };
    }
  }

  return { records: pruneResolved(records) };
}

/** Keep the ledger bounded: live records always kept, resolved history capped. */
function pruneResolved(records: Record<string, IncidentRecord>): Record<string, IncidentRecord> {
  const resolved = Object.values(records)
    .filter((r) => r.resolvedAt != null)
    .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));
  if (resolved.length <= MAX_RESOLVED_HISTORY) return records;
  const drop = new Set(resolved.slice(MAX_RESOLVED_HISTORY).map((r) => r.key));
  const out: Record<string, IncidentRecord> = {};
  for (const [k, v] of Object.entries(records)) if (!drop.has(k)) out[k] = v;
  return out;
}

/** Acknowledge = "this operator has read it". It does NOT resolve anything. */
export function acknowledgeIncident(
  state: IncidentState,
  key: string,
  atMs: number
): IncidentState {
  const rec = state.records[key];
  if (!rec) return state;
  return {
    records: {
      ...state.records,
      [key]: { ...rec, acknowledgedAt: rec.acknowledgedAt == null ? atMs : null },
    },
  };
}

/** Live (unresolved) records, newest event first. */
export function liveIncidents(state: IncidentState): IncidentRecord[] {
  return Object.values(state.records)
    .filter((r) => r.resolvedAt == null)
    .sort((a, b) => (b.occurredAtMs ?? b.firstObservedAtMs) - (a.occurredAtMs ?? a.firstObservedAtMs));
}

/** Resolved records, most recently resolved first - the history view. */
export function resolvedIncidents(state: IncidentState): IncidentRecord[] {
  return Object.values(state.records)
    .filter((r) => r.resolvedAt != null)
    .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));
}

/**
 * The age an incident should display. Derived from the EVENT, so repeated
 * rendering of the same event yields the same age instead of resetting to 0s.
 * Null when the producer supplied no event time - rendered as "no timestamp".
 */
export function incidentAgeMs(rec: IncidentRecord, nowMs: number): number | null {
  if (rec.occurredAtMs == null) return null;
  return Math.max(0, nowMs - rec.occurredAtMs);
}
