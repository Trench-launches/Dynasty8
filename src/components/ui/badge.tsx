import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-violet/8 text-violet",
        sunset: "bg-sunset text-white",
        demo: "bg-tangerine/25 text-[#9a4a10] ring-1 ring-tangerine/60",
        dark: "bg-midnight text-cream",
        up: "bg-up/12 text-[#0d7d5c]",
        down: "bg-down/12 text-[#c42746]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** The label every simulated number carries. */
export function DemoTag({ className, label = "Demo data" }: { className?: string; label?: string }) {
  return (
    <Badge variant="demo" className={className} title="Simulated value for this prototype. Not live market data.">
      {label}
    </Badge>
  );
}
