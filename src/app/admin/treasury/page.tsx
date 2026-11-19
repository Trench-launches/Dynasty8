import type { Metadata } from "next";
import { TreasurySigner } from "@/components/admin/treasury-signer";

export const metadata: Metadata = {
  title: "Treasury signing",
  description: "Multisig members review and sign Demolition Fund proposals with their own wallet.",
  robots: { index: false, follow: false },
};

/** Members-only signing page. Data loads client-side from admin APIs (GitHub sign-in + role). */
export default function TreasuryPage() {
  return (
    <main className="min-h-dvh bg-vc-surface-2">
      <TreasurySigner />
    </main>
  );
}
