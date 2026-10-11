// [V3-07 / #225] Page-header height budget, in EVERY catalog.
//
// WHY THIS SPEC EXISTS. The R2 visual lane holds the Overview header under 80px
// so it cannot become a hero again - but it only ever ran the English catalog.
// V3-01 replaced the bespoke header row with the shared `PageHeader`, which puts
// the title, the live connection chip and the page actions in ONE `flex-wrap`
// row and adds a purpose line beneath it. At 390px that row had ~2px of slack in
// English, so it fitted in this sandbox and wrapped on the CI runner, where a
// slightly different font metric pushed the actions onto a second row: 56px
// became 84px and the e2e-ui lane went red at 07e04a7.
//
// In Sinhala the same header wrapped WITHOUT any font difference - 100px, over
// the ceiling, on a real device width - and no gate caught it, because no gate
// looked at Sinhala. That is the hole this spec closes.
//
// WHAT IT PINS.
//   1. the header stays under the SAME 80px R2 ceiling at every viewport and in
//      both catalogs - the ceiling is not raised anywhere to accommodate this;
//   2. the actions slot stays on the title row (the wrapping is the mechanism,
//      so it is asserted directly, not only through its effect on height);
//   3. the header is not made small by DELETING anything: title, connection chip
//      and actions are all present, and the presentation summary the phone width
//      withdraws from paint is still in the DOM and still carried in the link
//      accessible name;
//   4. no horizontal overflow at any of these widths.
//
// BROWSER HONESTY. This is Chromium viewport + UA emulation. It is NOT an
// iPhone and NOT an Android device: REAL_DEVICE stays NOT_MEASURED. A pass here
// proves the layout is deterministic across catalogs and font metrics, not that
// a physical phone renders it identically.
import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  phoneLandscape: { width: 844, height: 390 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

// Both catalogs the product ships. Sinhala is not an afterthought here: it is
// the language the operator reads, and it is wider than English.
const CATALOGS = ["en", "si"] as const;

// The R2 ceiling, unchanged. Deliberately not re-derived from a measurement of
// the current build - a budget that is set to whatever the code happens to do
// is not a budget.
const HEADER_CEILING_PX = 80;

async function gotoOverview(page: Page, lang: (typeof CATALOGS)[number]) {
  // `ghrdp:lang` is the zustand persist key; the store shape is
  // { state: { lang }, version: 0 }. Seeded before first paint so the very
  // first layout is the one under test, not a re-layout after a swap.
  await page.addInitScript(
    (l) =>
      localStorage.setItem("ghrdp:lang", JSON.stringify({ state: { lang: l }, version: 0 })),
    lang
  );
  await page.goto("/#/");
  await page.waitForSelector('[data-testid="app-topbar"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="overview-header"]', { timeout: 15000 });
  // Let the polling hook settle so the measurement is not mid-flight.
  await page.waitForTimeout(1200);
}

/** Everything the assertions need, read in one pass from the live layout. */
const PROBE = () => {
  const q = (s: string) => document.querySelector(s);
  const rect = (el: Element | null) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
  };
  const header = q('[data-testid="overview-header"]');
  const title = q('[data-testid="overview-header-title"]');
  const status = q('[data-testid="overview-header-status"]');
  const actions = q('[data-testid="overview-header-actions"]');
  const subtitle = q('[data-testid="overview-header-subtitle"]');
  const link = q('[data-testid="overview-glass-settings-link"]');
  const summary = q('[data-testid="overview-glass-summary"]');
  const chip = q('[id="overview-conn-state"]');
  const t = rect(title);
  const a = rect(actions);
  return {
    headerHeight: rect(header)?.height ?? null,
    titleHeight: t?.height ?? null,
    actionsTop: a?.top ?? null,
    titleBottom: t?.bottom ?? null,
    // The wrap is the failure mechanism: actions dropping BELOW the title row.
    actionsWrappedBelowTitle: t && a ? a.top >= t.bottom - 1 : null,
    subtitleText: subtitle?.textContent?.trim() ?? null,
    subtitleTitle: subtitle?.getAttribute("title") ?? null,
    summaryText: summary?.textContent?.trim() ?? null,
    summaryPaintedWidth: rect(summary)?.width ?? null,
    linkAriaLabel: link?.getAttribute("aria-label") ?? null,
    hasChip: chip !== null,
    hasTitle: title !== null,
    hasActions: actions !== null,
    statusText: status?.textContent?.trim() ?? null,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    htmlLang: document.documentElement.lang,
  };
};

test.describe("V3 page-header height budget (all catalogs)", () => {
  for (const lang of CATALOGS) {
    for (const [label, vp] of Object.entries(VIEWPORTS)) {
      test(`header stays under ${HEADER_CEILING_PX}px in ${lang} at ${label} (${vp.width}x${vp.height})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await gotoOverview(page, lang);

        const m = await page.evaluate(PROBE);

        // The catalog actually took effect - otherwise this is an English test
        // wearing a Sinhala label, which is how the 100px header shipped.
        expect(m.htmlLang, `html[lang] must follow the ${lang} catalog`).toBe(lang);

        // (1) the budget, at the SAME ceiling R2 uses
        expect(
          m.headerHeight,
          `${lang}/${label}: header must stay under ${HEADER_CEILING_PX}px, not become a hero`
        ).not.toBeNull();
        expect(m.headerHeight!, `${lang}/${label} header height`).toBeLessThan(HEADER_CEILING_PX);

        // (2) the mechanism: one title row, actions never pushed below it
        expect(
          m.actionsWrappedBelowTitle,
          `${lang}/${label}: the actions slot must share the title row, not wrap under it`
        ).toBe(false);

        // (3) not small by deletion - every part of the header contract is there
        expect(m.hasTitle, `${lang}/${label}: the page name must still render`).toBe(true);
        expect(m.hasChip, `${lang}/${label}: the connection chip must still render`).toBe(true);
        expect(m.hasActions, `${lang}/${label}: the page actions must still render`).toBe(true);
        expect((m.statusText ?? "").length, `${lang}/${label}: connection state is labelled`).toBeGreaterThan(0);

        // The purpose line keeps its full text in the DOM even when it is
        // clamped at narrow widths, and says so through `title`.
        expect((m.subtitleText ?? "").length, `${lang}/${label}: purpose line is not empty`).toBeGreaterThan(10);
        if (vp.width < 640) {
          expect(
            m.subtitleTitle,
            `${lang}/${label}: a clamped purpose line must still expose its full text`
          ).toBe(m.subtitleText);
        }

        // The presentation summary the phone width withdraws from paint is not
        // removed: it stays in the DOM and is carried in the accessible name.
        expect((m.summaryText ?? "").length, `${lang}/${label}: summary text stays in the DOM`).toBeGreaterThan(0);
        expect(
          m.linkAriaLabel ?? "",
          `${lang}/${label}: the link accessible name must carry the presentation summary`
        ).toContain(m.summaryText!);

        // (4) no horizontal overflow
        expect(m.overflowX, `${lang}/${label}: no horizontal overflow`).toBeLessThanOrEqual(1);
      });
    }
  }

  test("the phone width withdraws the summary from PAINT without losing it, and desktop paints it", async ({
    page,
  }) => {
    // Pins the responsive contract itself, so the fix cannot be silently
    // replaced by something that hides the summary at every width.
    await page.setViewportSize(VIEWPORTS.phone);
    await gotoOverview(page, "si");
    const phone = await page.evaluate(PROBE);
    expect(phone.summaryPaintedWidth!, "phone: summary is withdrawn from paint").toBeLessThanOrEqual(2);
    expect((phone.summaryText ?? "").length, "phone: summary text is still in the DOM").toBeGreaterThan(0);

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.waitForTimeout(400);
    const desktop = await page.evaluate(PROBE);
    expect(desktop.summaryPaintedWidth!, "desktop: summary is painted").toBeGreaterThan(50);
  });
});
