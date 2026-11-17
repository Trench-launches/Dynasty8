"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <TriangleAlert className="size-12 text-coral" aria-hidden />
      <h1 className="mt-3 font-display text-3xl tracking-wide text-violet">Something went sideways</h1>
      <p className="mt-2 text-sm text-violet/70">
        This page hit an unexpected error while loading. Your browsing is safe; nothing was sent or signed.
      </p>
      <Button className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
