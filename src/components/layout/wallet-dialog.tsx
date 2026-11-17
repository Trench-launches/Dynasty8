"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Explains that wallet connection is not part of this prototype. It never pretends
 * to connect, never shows balances, and browsing does not need a wallet.
 */
export function WalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center bg-midnight/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-title"
            initial={{ y: 24, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 24, scale: 0.97 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-3xl bg-cream shadow-2xl"
          >
            <div className="bg-sunset relative px-6 py-5 text-white">
              <Wallet className="size-8" aria-hidden />
              <h2 id="wallet-title" className="mt-2 font-display text-2xl tracking-wide">
                Wallet connection is coming soon
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-white/20 hover:bg-white/30"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-3 px-6 py-5 text-sm text-violet/80">
              <p>
                This is a frontend prototype. No wallet is connected, nothing is signed, and no balances are shown.
              </p>
              <p>You can browse every property, map and market without a wallet.</p>
              <p>
                The next phase adds Solana wallet support (for example Phantom and Solflare through the Solana wallet
                adapter) and links to each token&apos;s Pump.fun market once it launches.
              </p>
              <Button variant="dark" className="mt-2 w-full" onClick={onClose}>
                Keep browsing
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
