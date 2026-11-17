import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** shadcn/ui-style button, themed for the sunset palette. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        sunset:
          "bg-sunset text-white shadow-[0_6px_20px_-6px_rgba(255,107,157,0.7)] hover:brightness-105 hover:-translate-y-px active:translate-y-0",
        dark: "bg-midnight text-cream hover:bg-violet",
        outline: "border-2 border-violet/15 bg-white/70 text-violet hover:border-sunset hover:text-sunset",
        ghost: "text-violet hover:bg-violet/8",
        soft: "bg-white text-violet shadow-sm ring-1 ring-violet/10 hover:ring-sunset/60",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "sunset", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
