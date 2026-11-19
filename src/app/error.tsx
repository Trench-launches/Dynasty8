"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="max-w-md space-y-4">
        <Logo variant="light" className="mb-6 justify-center" />
        <p className="font-display text-5xl tracking-wide text-vc-text">WASTED</p>
        <p className="text-vc-muted">Something went wrong loading the property market. The listings service may be unavailable.</p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-lg bg-sunset-gradient px-5 py-2.5 text-sm font-extrabold text-ink"
          >
            Try again
          </button>
          <Link href="/" className="rounded-lg border border-vc-line px-5 py-2.5 text-sm font-bold text-vc-text hover:bg-vc-surface-2">
            Back to map
          </Link>
        </div>
      </div>
    </div>
  );
}
