import { cn } from "@/lib/utils";

/**
 * Listing-style building blocks shared by every page: the green serrated panel bar, green section
 * headings, big figures with a small unit, spec-table rows and tag chips.
 */

/** Green bar with a serrated bottom edge: white uppercase title, optional yellow note on the right. */
export function PanelHeader({
  id,
  title,
  note,
  as: Heading = "h2",
  className,
}: {
  id?: string;
  title: React.ReactNode;
  note?: React.ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <header className={cn("zigzag-bottom bg-d8-green px-4 pt-3 pb-[calc(0.75rem+5px)] text-white sm:px-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading id={id} className="text-[17px] leading-tight font-semibold tracking-[0.06em] uppercase sm:text-lg">
          {title}
        </Heading>
        {note && <p className="text-[15px] leading-tight font-medium tracking-[0.04em] text-d8-yellow uppercase">{note}</p>}
      </div>
    </header>
  );
}

/** A section card under a PanelHeader. Pass the header as the first child. */
export function Panel({ className, children, ...rest }: React.ComponentProps<"section">) {
  return (
    <section className={cn("min-w-0 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]", className)} {...rest}>
      {children}
    </section>
  );
}

/** Panel body: the bordered area under the serrated bar (the bar itself has no border). */
export function PanelBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("border border-t-0 border-[#e3e3e3]", className)}>{children}</div>;
}

/** Green uppercase section heading ("HOW YOU EARN ..."). */
export function SectionHeading({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className={cn("text-[21px] leading-tight font-normal tracking-[0.04em] text-d8-green uppercase", className)}>
      {children}
    </h2>
  );
}

/** Small grey uppercase label ("PRICE"). */
export function FigureLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-[15px] tracking-[0.06em] text-[#777] uppercase", className)}>{children}</p>;
}

/** Big light number with a small grey unit after it ("1,000,000 DYNASTY8"). */
export function BigFigure({
  value,
  unit,
  size = "lg",
  className,
}: {
  value: React.ReactNode;
  unit?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <p className={cn("flex min-w-0 items-baseline gap-2 leading-none text-d8-ink tabular-nums", className)}>
      <span
        className={cn(
          "truncate font-normal tracking-[-0.01em]",
          size === "lg" && "text-[46px]",
          size === "md" && "text-[32px]",
          size === "sm" && "text-[26px]",
        )}
      >
        {value}
      </span>
      {unit && (
        <span className={cn("shrink-0 text-[#555] uppercase", size === "lg" ? "text-[19px]" : "text-[15px]")}>{unit}</span>
      )}
    </p>
  );
}

/** Spec table: label on the left, bold value on the right, hairlines between rows. */
export function SpecList({ className, children }: { className?: string; children: React.ReactNode }) {
  return <dl className={cn("border-t border-[#e3e3e3]", className)}>{children}</dl>;
}

export function SpecRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#e3e3e3] py-[18px]">
      <dt className="text-[17px] text-[#444]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[17px] font-bold text-d8-ink tabular-nums">{children}</dd>
    </div>
  );
}

/** Small uppercase tag chip ("1X SOL"): soft green or soft gold. */
export function Tag({
  tone = "green",
  className,
  children,
}: {
  tone?: "green" | "gold" | "grey";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 px-2.5 py-1 text-[13px] leading-none tracking-[0.04em] whitespace-nowrap uppercase",
        tone === "green" && "bg-d8-mint text-[#1d5a33]",
        tone === "gold" && "bg-d8-gold-soft text-d8-gold-ink",
        tone === "grey" && "bg-[#ececec] text-[#666]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Square selector box ("1 | 10 | 50 | 100"), green when chosen. */
export const choiceBox = (active: boolean) =>
  cn(
    "inline-flex h-11 min-w-12 items-center justify-center gap-1 border-2 px-3.5 text-[16px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    active ? "border-d8-green bg-d8-green text-white" : "border-[#e3e3e3] bg-white text-[#333] hover:border-[#c9c9c9]",
  );

/** Wide green call-to-action ("CONNECT WALLET TO BUY"). */
export const ctaButton =
  "flex h-[60px] w-full items-center justify-center gap-2 border-b-[3px] border-[#0f4a27] bg-d8-green px-4 text-[21px] tracking-[0.02em] text-white uppercase transition-colors outline-none hover:bg-d8-green-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Rounded green pill ("BUY" / "VIEW" on listing cards). */
export const pillButton =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-d8-green px-7 text-[17px] tracking-[0.02em] text-white uppercase transition-colors outline-none hover:bg-d8-green-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

/** Page title block: big bold dark heading with a grey intro line. */
export function PageTitle({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h1 className="text-[38px] leading-[1.1] font-bold text-d8-ink sm:text-[48px]">{title}</h1>
      {children && <p className="mt-2 max-w-2xl text-[17px] leading-relaxed text-[#555]">{children}</p>}
    </div>
  );
}

/** Headline figure box for a page's summary row. */
export function SummaryStat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="min-w-0 border border-[#e3e3e3] bg-white px-4 py-3">
      <dt className="truncate text-[12px] tracking-[0.06em] text-[#777] uppercase sm:text-[13px]">{label}</dt>
      <dd className="mt-1 text-[24px] leading-none whitespace-nowrap text-d8-ink tabular-nums sm:text-[30px]">{value}</dd>
    </div>
  );
}
