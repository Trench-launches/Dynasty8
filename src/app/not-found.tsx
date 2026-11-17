import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="max-w-md space-y-4">
        <Logo variant="dark" className="mb-6 justify-center" />
        <p className="font-display text-6xl tracking-wide text-sunset-gradient">NOT ON THE MARKET</p>
        <p className="text-[#6c757d]">We couldn&apos;t find that listing. It may have been renamed or removed.</p>
        <Link
          href="/"
          className="inline-flex rounded-lg bg-sunset-gradient px-5 py-2.5 text-sm font-extrabold text-ink"
        >
          Back to the map
        </Link>
      </div>
    </div>
  );
}
