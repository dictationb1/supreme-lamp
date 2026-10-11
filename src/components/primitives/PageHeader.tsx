// [V3-01 / D4] PageHeader — the shared page identity for EVERY route.
//
// WHY THIS COMPONENT EXISTS. Ten of the eleven routes opened with a bespoke
// `<div className="flex items-center gap-2 mb-4">` wrapping an `<h2>` at
// `text-xl`, with no shared contract for the page's purpose, its live status or
// its actions. That is why the redesign did not read as one product outside
// Overview: each page was inventing its own header, and each invention drifted.
//
// THE CONTRACT.
//   * one `<header>` per route, `aria-labelledby` pointing at its own title;
//   * the title is the page name at 16px — a NAME, not a hero. The old 20px
//     repeat of the app title was the "unused vertical area" the operator
//     reported, and it is removed by not rendering it, not by a negative
//     margin;
//   * an optional `subtitle` states what the page is FOR, in one line;
//   * an optional `status` slot carries live state (chips, phase, freshness);
//   * an optional `actions` slot is pushed to the end and wraps on narrow
//     viewports instead of overflowing.
//
// IT PAINTS NOTHING. The header sits directly on the app glass sheet, so it
// must not add a plate of its own — that would put an opaque bar above the very
// material the redesign is about.
import React from "react";
import { cn } from "@/lib/cn";

// `title` is a ReactNode here (a page name may carry an icon or a chip), so the
// native HTML `title` attribute is deliberately Omitted rather than widened:
// a tooltip string and a heading are different things.
export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** A 16-20px lucide glyph. Decorative: the title carries the meaning. */
  icon?: React.ReactNode;
  /** The page name. */
  title: React.ReactNode;
  /** One line on what the page is for. */
  subtitle?: React.ReactNode;
  /** Live state: chips, phase, freshness. Rendered after the title. */
  status?: React.ReactNode;
  /** Page-level controls, pushed to the trailing edge and wrapped. */
  actions?: React.ReactNode;
  /**
   * Test-id prefix. Also seeds the derived ids:
   * `<testId>-title`, `-subtitle`, `-status`, `-actions`, `-icon`.
   */
  testId: string;
  /** Override the generated `aria-labelledby` id. */
  titleId?: string;
  /** `true` on routes that already render a large hero (keeps spacing sane). */
  dense?: boolean;
  className?: string;
}

export function PageHeader({
  icon,
  title,
  subtitle,
  status,
  actions,
  testId,
  titleId,
  dense = false,
  className,
  ...rest
}: PageHeaderProps) {
  const headingId = titleId || `${testId}-heading`;
  return (
    <header
      data-testid={testId}
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-1", dense ? "mb-3" : "mb-4", className)}
      {...rest}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {icon ? (
          <span
            data-testid={`${testId}-icon`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <h2
          id={headingId}
          data-testid={`${testId}-title`}
          className="text-base font-semibold leading-none text-primary"
        >
          {title}
        </h2>
        {status ? (
          <div data-testid={`${testId}-status`} className="flex flex-wrap items-center gap-2">
            {status}
          </div>
        ) : null}
        {actions ? (
          <div
            data-testid={`${testId}-actions`}
            className="ml-auto flex flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        ) : null}
      </div>
      {subtitle ? (
        <p data-testid={`${testId}-subtitle`} className="text-xs text-tertiary">
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}

export default PageHeader;
