// [SEARCH-REPAIR] The browser/provider wiring: one place that builds the
// ProviderContext the adapters run with.
//
// Two settings matter and both are honest:
//   * relayBase - the dashboard server's /api/providers/relay. It is only used
//     when a host sends no CORS header (github.com HTML, rentry raw on some
//     proxies, arbitrary operator sites). When the route is missing the adapter
//     says RELAY_UNAVAILABLE rather than pretending the site is broken.
//   * tokens - OPTIONAL. A public GitHub repository, a public README, an
//     archive.org item and an anonymous Openverse search all work with NO
//     token. The token fields exist only to raise provider rate limits or to
//     reach content the operator explicitly owns.
import { apiBase, getKey } from "@/lib/api";
import type { ProviderContext } from "./core";

export const RELAY_PATH = "/api/providers/relay";

const TOKEN_KEY = "ghrdp:providerTokens";

export interface ProviderTokens {
  github?: string;
  openverse?: string;
}

function readTokens(): ProviderTokens {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProviderTokens;
    return { github: parsed.github || undefined, openverse: parsed.openverse || undefined };
  } catch {
    return {};
  }
}

export function saveProviderTokens(tokens: ProviderTokens): void {
  try {
    const clean: ProviderTokens = {};
    if (tokens.github && tokens.github.trim()) clean.github = tokens.github.trim();
    if (tokens.openverse && tokens.openverse.trim()) clean.openverse = tokens.openverse.trim();
    if (!clean.github && !clean.openverse) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, JSON.stringify(clean));
  } catch {
    /* a denied storage area only means the tokens are per-session */
  }
}

export function providerTokens(): ProviderTokens {
  return readTokens();
}

export interface BuildContextOptions {
  signal?: AbortSignal;
  /** Disable the relay (used by the pure-direct path and by tests). */
  relay?: boolean;
}

export function buildProviderContext(opts: BuildContextOptions = {}): ProviderContext {
  const tokens = readTokens();
  return {
    fetchImpl: typeof fetch === "function" ? fetch.bind(globalThis) : undefined,
    signal: opts.signal,
    relayBase: opts.relay === false ? undefined : apiBase() + RELAY_PATH,
    githubToken: tokens.github,
    openverseToken: tokens.openverse,
  };
}

/** True when a dashboard token is present, i.e. the relay has any chance of
 *  being accepted. Used for a precise message, never for a credential prompt. */
export function relayLikelyAvailable(): boolean {
  return Boolean(getKey());
}
