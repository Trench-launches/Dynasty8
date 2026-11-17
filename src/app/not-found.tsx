import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-sunset font-display text-7xl">404</p>
      <h1 className="mt-2 font-display text-3xl tracking-wide text-violet">This property is off the market</h1>
      <p className="mt-2 text-sm text-violet/70">The listing you are looking for does not exist or was removed.</p>
      <Link href="/" className={buttonVariants({ className: "mt-5" })}>
        Back to Map
      </Link>
    </div>
  );
}
