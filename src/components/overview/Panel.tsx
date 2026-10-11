// [R2 / #213 §6] Panel - the Overview's content surface.
//
// It is a `GlassContainer` with `surface="nested"` on purpose: the sticky
// TopBar owns the shell's ONE backdrop-filter read (#213 §6 compositor budget),
// and every card below it paints paint-only on the shared backdrop. A page
// with a dozen panels therefore still costs one blur - and because the page
// background is transparent, `.app-backdrop`'s gradient shows through each
// panel's fill alpha, which is what makes the glass perceptible instead of
// merely present in the CSS.
import React from "react";
import { cn } from "@/lib/cn";
import GlassContainer from "@/components/primitives/GlassContainer";
import type { GlassVariant } from "@/components/primitives/GlassContainer";

export function Panel({
  as = "section",
  title,
  icon,
  actions,
  labelledBy,
  variant = "tinted",
  dense = false,
  className,
  children,
  ...rest
}: {
  as?: "section" | "div" | "nav" | "aside" | "form";
  title?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  labelledBy?: string;
  variant?: GlassVariant;
  dense?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const titleId =
    labelledBy ||
    (typeof title === "string" ? "panel-title-" + title.replace(/\s+/g, "-").toLowerCase() : undefined);
  return (
    <GlassContainer
      as={as}
      level="card"
      surface="nested"
      variant={variant}
      radius="lg"
      aria-labelledby={title ? titleId : undefined}
      className={cn(dense ? "p-3" : "p-4", className)}
      {...rest}
    >
      {title ? (
        <div className={cn("flex items-center gap-2", dense ? "mb-2" : "mb-3")}>
          {icon}
          <h2 id={titleId} className="text-sm font-semibold text-primary">
            {title}
          </h2>
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </GlassContainer>
  );
}

/** A labelled key/value line. The key is tertiary text, the value primary. */
export function Field({
  label,
  children,
  id,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div id={id} className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 border-b border-default last:border-0", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary w-36 shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2 min-w-0 text-sm text-primary">{children}</div>
    </div>
  );
}
