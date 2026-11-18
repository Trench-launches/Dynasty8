"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck, Wallet, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/format";
import { formatSol, formatTokenAmount } from "@/lib/fund-format";
import { Keypair } from "@solana/web3.js";
import { getPhantom, signAndSend, signWithMintAndSend } from "@/lib/phantom";

/**
 * Treasury signing page for multisig members. Connect Phantom, review a buyback proposal, then
 * sign in Phantom. The server only builds UNSIGNED transactions; the Squads program counts
 * approvals and enforces the threshold. No key is ever entered into or held by this site.
 */

type Member = { key: string; initiate: boolean; vote: boolean; execute: boolean };
type Status = {
  wallets: { role: string; address: string; label: string; isMultisig: boolean; vaultIndex: number; multisigAddress: string | null }[];
  multisig: null | { address: string; threshold: number; timeLockSeconds: number; configAuthority: string | null; members: Member[]; vaults: { role: string; index: number; address: string }[] };
  assessment: null | { ok: boolean; problems: string[]; warnings: string[] };
  connected: null | { address: string; isMember: boolean; permissions: Member | null };
};
type Proposal = {
  id: string;
  requestId: string;
  purpose: "SWAP" | "BURN";
  status: string;
  transactionIndex: string;
  proposalPda: string;
  approvals: number;
  threshold: number;
  amount: string;
  executedSignature: string | null;
  createdAt: string;
};
type Buyback = { id: string; status: string; budgetLamports: string; tokensReceivedRaw: string | null; tokensBurnedRaw: string; createdAt: string };
type Review = { title: string; lines: [string, string][]; transactionBase64: string; signer: string; mint?: Keypair; onSent?: (signature: string) => void };
type LaunchCoin = { slug: string; kind: "NATIVE" | "PROPERTY"; name: string; symbol: string; status: string; pending: string[]; registered: { mint: string | null; deploymentStatus: string | null } };
const LT_KEY = "d8.launchLookupTable";

const solscan = (kind: "account" | "tx", v: string) => `https://solscan.io/${kind}/${v}`;
const LIVE = ["PREPARED", "CREATED", "APPROVED", "EXECUTED"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message ?? `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export function TreasurySigner() {
  const [wallet, setWallet] = useState<string | null>(null);
  // null while server-rendering; Phantom injects itself before page scripts run.
  const hasPhantom = useSyncExternalStore(noopSubscribe, () => !!getPhantom(), () => null);
  const [status, setStatus] = useState<Status | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [buybacks, setBuybacks] = useState<Buyback[]>([]);
  const [authError, setAuthError] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [sent, setSent] = useState<{ label: string; signature: string } | null>(null);
  const [setupMint, setSetupMint] = useState("");
  const [launchCoins, setLaunchCoins] = useState<LaunchCoin[]>([]);
  const [launchSlug, setLaunchSlug] = useState("");
  const [launchUri, setLaunchUri] = useState("");
  const [lookupTable, setLookupTableState] = useState("");
  useEffect(() => {
    // Remembered per browser (a convenience only); read after mount so server and client HTML match.
    void Promise.resolve().then(() => {
      try {
        const saved = window.localStorage.getItem(LT_KEY);
        if (saved) setLookupTableState(saved);
      } catch {
        /* storage unavailable */
      }
    });
  }, []);
  const [launched, setLaunched] = useState<{ slug: string; kind: string; symbol: string; mint: string; signature: string } | null>(null);
  const setLookupTable = (v: string) => {
    setLookupTableState(v);
    try {
      window.localStorage.setItem(LT_KEY, v);
    } catch {
      /* storage unavailable: keep it in memory */
    }
  };

  const load = useCallback(async (member: string | null) => {
    try {
      const q = member ? `?member=${member}` : "";
      const [s, p, b, l] = await Promise.all([
        api<Status>(`/api/admin/demolition-fund/multisig${q}`),
        api<{ items: Proposal[] }>("/api/admin/demolition-fund/proposals"),
        api<{ items: Buyback[] }>("/api/admin/demolition-fund/buybacks"),
        api<{ items: LaunchCoin[] }>("/api/admin/demolition-fund/launch"),
      ]);
      setStatus(s);
      setProposals(p.items);
      setBuybacks(b.items);
      setLaunchCoins(l.items);
      setAuthError(null);
    } catch (e) {
      const st = (e as { status?: number }).status;
      if (st === 401 || st === 403) setAuthError(st);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const phantom = getPhantom();
    if (phantom) {
      phantom.connect({ onlyIfTrusted: true }).then((r) => setWallet(r.publicKey.toBase58())).catch(() => {});
      const onChange = (pk: { toBase58(): string } | null) => setWallet(pk ? pk.toBase58() : null);
      phantom.on("accountChanged", onChange);
      return () => phantom.removeListener?.("accountChanged", onChange as (...a: unknown[]) => void);
    }
  }, []);

  useEffect(() => {
    // Deferred so the fetch never sets state synchronously inside the effect.
    void Promise.resolve().then(() => load(wallet));
  }, [wallet, load]);

  async function connect() {
    setError(null);
    const phantom = getPhantom();
    if (!phantom) return;
    try {
      const r = await phantom.connect();
      setWallet(r.publicKey.toBase58());
    } catch {
      setError("Phantom connection was cancelled");
    }
  }

  async function disconnect() {
    await getPhantom()?.disconnect();
    setWallet(null);
  }

  async function prepare(label: string, fn: () => Promise<Review>) {
    setError(null);
    setSent(null);
    setBusy(label);
    try {
      setReview(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmAndSign() {
    if (!review) return;
    setBusy("sign");
    setError(null);
    try {
      const signature = review.mint ? await signWithMintAndSend(review.transactionBase64, review.signer, review.mint) : await signAndSend(review.transactionBase64, review.signer);
      setSent({ label: review.title, signature });
      review.onSent?.(signature);
      setReview(null);
      await api("/api/admin/demolition-fund/proposals", { method: "POST" }).catch(() => {});
      await load(wallet);
    } catch (e) {
      setError((e as Error).message || "Phantom did not sign the transaction");
    } finally {
      setBusy(null);
    }
  }

  const propose = (b: Buyback, purpose: "swap" | "burn") =>
    prepare(`propose-${b.id}`, async () => {
      const r = await api<{ transactionIndex: string; threshold: number; vault: string; summary: Record<string, unknown>; transactionBase64: string; transactionBytes: number; expectedMessage: { instructions: unknown[] } }>(
        `/api/admin/demolition-fund/buybacks/${b.id}/propose-${purpose}`,
        { method: "POST", body: JSON.stringify({ creator: wallet }) },
      );
      return {
        title: purpose === "swap" ? "Create buyback proposal" : "Create burn proposal",
        signer: wallet!,
        transactionBase64: r.transactionBase64,
        lines: [
          ["What it does", "Creates a Squads proposal. It does NOT move funds: it needs the multisig threshold of approvals and then a separate execute."],
          [purpose === "swap" ? "Spend (max)" : "Burn", purpose === "swap" ? formatSol(String(r.summary.inLamports ?? b.budgetLamports)) : `${formatTokenAmount(String(r.summary.burnRaw), null)} raw units of $DYNASTY`],
          ...(purpose === "swap" ? ([["Minimum $DYNASTY out (raw)", String(r.summary.minOut)], ["Price impact", `${Number(r.summary.priceImpactBps) / 100}%`]] as [string, string][]) : []),
          ["From vault", r.vault],
          ["Proposal #", r.transactionIndex],
          ["Threshold", `${r.threshold} approvals`],
          ["Inner instructions", String(r.expectedMessage.instructions.length)],
          ["Fee payer / signer", `${wallet} (you)`],
        ],
      };
    });

  const createLookupTable = () =>
    prepare("lookup-table", async () => {
      const r = await api<{ lookupTable: string; addresses: string[]; transactionBase64: string }>("/api/admin/demolition-fund/launch/lookup-table", {
        method: "POST",
        body: JSON.stringify({ authority: wallet }),
      });
      return {
        title: "Create the launch lookup table",
        signer: wallet!,
        transactionBase64: r.transactionBase64,
        lines: [
          ["What it does", "Creates a small on-chain address table (one time, about 0.004 SOL rent) so each coin launch fits in a single transaction. It moves no funds and grants no permissions."],
          ["Table address", r.lookupTable],
          ["Addresses stored", `${r.addresses.length} (Pump programs, globals and event authorities, Mayhem accounts, token programs)`],
          ["Fee payer / signer", `${wallet} (you)`],
        ],
        onSent: () => setLookupTable(r.lookupTable),
      };
    });

  const prepareLaunch = () =>
    prepare("launch", async () => {
      const coin = launchCoins.find((c) => c.slug === launchSlug);
      if (!coin) throw new Error("Choose a coin");
      // The mint keypair lives only in this tab; only its public key is sent to the server.
      const mint = Keypair.generate();
      const r = await api<{ name: string; symbol: string; uri: string; mint: string; sharingConfig: string; shareholders: { address: string; shareBps: number }[]; transactionBase64: string; transactionBytes: number; simulation: { unitsConsumed: number | null } }>(
        "/api/admin/demolition-fund/launch/prepare",
        { method: "POST", body: JSON.stringify({ slug: coin.slug, creator: wallet, mint: mint.publicKey.toBase58(), uri: launchUri.trim(), lookupTable: lookupTable.trim() }) },
      );
      return {
        title: `Launch $${r.symbol} on Pump.fun`,
        signer: wallet!,
        mint,
        transactionBase64: r.transactionBase64,
        lines: [
          ["What it does", "Creates the coin on Pump.fun AND locks its creator fees to the treasury in the same transaction. This is a live launch; it cannot be undone."],
          ["Name / symbol", `${r.name} / ${r.symbol}`],
          ["Metadata", r.uri],
          ["New mint", r.mint],
          ...r.shareholders.map((h) => [`${roleOf(h.address)} · ${h.shareBps / 100}%`, h.address] as [string, string]),
          ["Simulation", `Passed on Solana mainnet (${r.simulation.unitsConsumed ?? "?"} compute units, ${r.transactionBytes} bytes; nothing sent)`],
          ["Signers", `the new mint (in this browser) and ${wallet} (you, creator and fee payer)`],
        ],
        onSent: (signature: string) => setLaunched({ slug: coin.slug, kind: coin.kind, symbol: coin.symbol, mint: r.mint, signature }),
      };
    });

  async function registerLaunchedMint() {
    if (!launched || !wallet) return;
    setBusy("register");
    setError(null);
    try {
      if (launched.kind === "NATIVE") {
        await api("/api/admin/ecosystem/token", { method: "POST", body: JSON.stringify({ mintAddress: launched.mint }) });
      } else {
        await api(`/api/admin/properties/${launched.slug}/token`, { method: "POST", body: JSON.stringify({ mintAddress: launched.mint, creatorWallet: wallet }) });
      }
      setSent({ label: `$${launched.symbol} mint registered (pending verification)`, signature: launched.signature });
      setLaunched(null);
      await load(wallet);
    } catch (e) {
      setError(`Registration failed: ${(e as Error).message}. The coin is live; retry once the transaction is finalized.`);
    } finally {
      setBusy(null);
    }
  }

  const roleOf = (address: string) => status?.wallets.find((w) => w.address === address)?.role ?? "unknown wallet";
  const feeSharingSetup = () =>
    prepare("setup", async () => {
      const r = await api<{ token: { ticker: string; kind: string }; steps: string[]; shareholders: { address: string; shareBps: number }[]; transactionBase64: string; sharingConfig: string; warnings: string[] }>(
        "/api/admin/demolition-fund/fee-sharing/setup",
        { method: "POST", body: JSON.stringify({ mint: setupMint.trim(), creator: wallet }) },
      );
      return {
        title: `Lock fee sharing for $${r.token.ticker}`,
        signer: wallet!,
        transactionBase64: r.transactionBase64,
        lines: [
          ["What it does", "Points this coin's Pump creator fees at the treasury vaults and locks the split permanently. It cannot be changed afterwards."],
          ["Steps", r.steps.join(" → ")],
          ...r.shareholders.map((h) => [`${roleOf(h.address)} · ${h.shareBps / 100}%`, h.address] as [string, string]),
          ["Sharing config", r.sharingConfig],
          ["Simulation", "Passed on Solana mainnet (nothing sent)"],
          ...r.warnings.map((w) => ["Note", w] as [string, string]),
          ["Fee payer / signer", `${wallet} (you, the coin's creator)`],
        ],
      };
    });

  const memberAction = (p: Proposal, action: "approve" | "reject" | "execute") =>
    prepare(`${action}-${p.id}`, async () => {
      const r = await api<{ transactionBase64: string; approvals: number; threshold: number; transactionIndex: string }>(
        `/api/admin/demolition-fund/proposals/${p.id}/${action}`,
        { method: "POST", body: JSON.stringify({ member: wallet }) },
      );
      const what = p.purpose === "SWAP" ? `buy $DYNASTY with up to ${formatSol(p.amount)}` : `burn ${formatTokenAmount(p.amount, null)} raw units of $DYNASTY`;
      return {
        title: action === "approve" ? "Approve proposal" : action === "reject" ? "Reject proposal" : "Execute proposal",
        signer: wallet!,
        transactionBase64: r.transactionBase64,
        lines: [
          ["Proposal", `#${r.transactionIndex}: ${what}`],
          ["Approvals now", `${r.approvals} of ${r.threshold}`],
          [
            "What it does",
            action === "execute"
              ? "Runs the approved transaction from the fund vault. The Squads program refuses it unless the threshold is met."
              : action === "approve"
                ? "Records your approval vote. It moves no funds."
                : "Records your rejection vote. It moves no funds.",
          ],
          ["Fee payer / signer", `${wallet} (you)`],
        ],
      };
    });

  const live = (requestId: string, purpose: "SWAP" | "BURN") => proposals.find((p) => p.requestId === requestId && p.purpose === purpose && LIVE.includes(p.status));
  const me = status?.connected;
  const canVote = !!me?.permissions?.vote;
  const canExec = !!me?.permissions?.execute;
  const canInit = !!me?.permissions?.initiate;
  const needsProposal = buybacks.filter((b) => (b.status === "APPROVED" && !live(b.id, "SWAP")) || (b.status === "SWAP_CONFIRMED" && !live(b.id, "BURN")));
  const open = proposals.filter((p) => ["PREPARED", "CREATED", "APPROVED"].includes(p.status));
  const done = proposals.filter((p) => !["PREPARED", "CREATED", "APPROVED"].includes(p.status)).slice(0, 20);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-d8-green uppercase">Demolition Fund · members only</p>
        <h1 className="font-display text-3xl font-bold text-[#212529]">Treasury signing</h1>
        <p className="max-w-2xl text-sm text-[#6c757d]">
          Review buyback and burn proposals and sign them with your own Phantom wallet. This site prepares unsigned transactions only; the Squads multisig counts
          approvals and enforces the threshold. Never enter a seed phrase or private key anywhere on this site.
        </p>
      </header>

      <Card title="Your wallet">
        {hasPhantom === false ? (
          <p className="text-sm text-[#495057]">
            Phantom was not found in this browser.{" "}
            <a className="font-semibold text-d8-green hover:underline" href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">
              Install Phantom
            </a>{" "}
            and reload.
          </p>
        ) : wallet ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded border border-[#ced4da] px-2 py-1 font-mono text-xs">
              <Wallet className="size-3.5" aria-hidden /> {shortAddress(wallet)}
            </span>
            {me ? (
              me.isMember ? (
                <span className="inline-flex items-center gap-1 text-d8-green">
                  <CheckCircle2 className="size-4" aria-hidden /> Multisig member ({perms(me.permissions!)})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <XCircle className="size-4" aria-hidden /> Not a member of the fund multisig: you can view but not sign
                </span>
              )
            ) : null}
            <button onClick={disconnect} className="ml-auto text-xs font-semibold text-[#6c757d] hover:underline">
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={connect}
            disabled={hasPhantom === null}
            className="inline-flex items-center gap-2 rounded bg-d8-green px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Wallet className="size-4" aria-hidden /> Connect Phantom
          </button>
        )}
      </Card>

      {authError ? (
        <Card title="Admin sign-in required">
          <p className="text-sm text-[#495057]">
            {authError === 401 ? "Sign in with the GitHub account that has an admin role to load proposals." : "Your GitHub account does not have an admin role for the fund."}
          </p>
          {authError === 401 && (
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js sign-in is an API route and needs a full page load
            <a href="/api/auth/signin?callbackUrl=/admin/treasury" className="mt-3 inline-flex rounded border border-[#ced4da] px-3 py-1.5 text-sm font-semibold text-d8-green hover:border-d8-green">
              Sign in with GitHub
            </a>
          )}
        </Card>
      ) : null}

      {error && (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {sent && (
        <p role="status" className="rounded border border-d8-green/40 bg-d8-green/10 px-3 py-2 text-sm text-[#212529]">
          {sent.label}: sent.{" "}
          <a className="inline-flex items-center gap-1 font-semibold text-d8-green hover:underline" href={solscan("tx", sent.signature)} target="_blank" rel="noopener noreferrer">
            {shortAddress(sent.signature)} <ExternalLink className="size-3" />
          </a>{" "}
          Status updates once the transaction is finalized.
        </p>
      )}

      {status && !authError && (
        <Card title="Fund multisig" action={<IconButton label="Sync with chain" busy={busy === "sync"} onClick={() => prepareSync()} />}>
          {status.multisig ? (
            <div className="space-y-3 text-sm">
              <dl className="grid gap-2 sm:grid-cols-3">
                <Fact k="Multisig" v={<Addr a={status.multisig.address} />} />
                <Fact k="Threshold" v={`${status.multisig.threshold} of ${status.multisig.members.length}`} />
                <Fact k="Time lock" v={status.multisig.timeLockSeconds ? `${status.multisig.timeLockSeconds}s` : "none"} />
              </dl>
              <div>
                <p className="text-[10px] tracking-wider text-[#868e96] uppercase">Vaults</p>
                <ul className="mt-1 grid gap-1 sm:grid-cols-3">
                  {status.multisig.vaults.map((v) => (
                    <li key={v.role} className="rounded bg-[#f8f9fa] px-2 py-1.5 text-xs">
                      <span className="font-semibold">{v.role}</span> · vault {v.index} · <Addr a={v.address} />
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] tracking-wider text-[#868e96] uppercase">Members</p>
                <ul className="mt-1 space-y-1">
                  {status.multisig.members.map((m) => (
                    <li key={m.key} className="flex flex-wrap items-center gap-2 text-xs">
                      <Addr a={m.key} />
                      <span className="text-[#6c757d]">{perms(m)}</span>
                      {m.key === wallet && <span className="rounded bg-d8-green px-1.5 py-0.5 text-[10px] font-semibold text-white">you</span>}
                    </li>
                  ))}
                </ul>
              </div>
              {status.assessment?.warnings.length ? (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                  {status.assessment.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[#6c757d]">No multisig fund wallet is registered yet. Register the fund vault first (see docs/DEMOLITION-FUND.md §16).</p>
          )}
        </Card>
      )}

      {status && !authError && (
        <Card title="Launch a coin (fees locked to the treasury from the first trade)">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[#6c757d]">
            <li>One time: create the launch lookup table with your launch wallet.</li>
            <li>Upload the coin&apos;s metadata JSON and square image to IPFS; paste the metadata URL.</li>
            <li>Prepare, review, sign in Phantom. Then register the mint.</li>
          </ol>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-[#495057]">
              Coin
              <select
                value={launchSlug}
                onChange={(e) => setLaunchSlug(e.target.value)}
                aria-label="Coin to launch"
                className="mt-1 block w-full rounded border border-[#ced4da] px-2 py-1.5 text-sm"
              >
                <option value="">Choose…</option>
                {launchCoins.map((c) => (
                  <option key={c.slug} value={c.slug} disabled={c.status !== "READY_FOR_OWNER_REVIEW" || !!c.registered.mint}>
                    ${c.symbol} · {c.name}
                    {c.registered.mint ? " (launched)" : c.status !== "READY_FOR_OWNER_REVIEW" ? " (decision pending)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#495057]">
              Lookup table
              <span className="mt-1 flex gap-2">
                <input
                  value={lookupTable}
                  onChange={(e) => setLookupTable(e.target.value)}
                  placeholder="Lookup table address"
                  aria-label="Lookup table address"
                  className="min-w-0 flex-1 rounded border border-[#ced4da] px-2 py-1.5 font-mono text-xs"
                />
                <ActionButton label="Create" variant="ghost" disabled={!wallet} busy={busy === "lookup-table"} onClick={createLookupTable} />
              </span>
            </label>
            <label className="text-xs text-[#495057] sm:col-span-2">
              Metadata URL (IPFS)
              <input
                value={launchUri}
                onChange={(e) => setLaunchUri(e.target.value)}
                placeholder="https://ipfs.io/ipfs/…"
                aria-label="Metadata URL"
                className="mt-1 block w-full rounded border border-[#ced4da] px-2 py-1.5 font-mono text-xs"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ActionButton
              label="Prepare launch"
              disabled={!wallet || !launchSlug || lookupTable.trim().length < 32 || !launchUri.startsWith("https://")}
              busy={busy === "launch"}
              onClick={prepareLaunch}
            />
            {launched && (
              <span className="text-sm">
                ${launched.symbol} sent as {shortAddress(launched.mint)}.{" "}
                <ActionButton label="Register mint" busy={busy === "register"} onClick={registerLaunchedMint} />
              </span>
            )}
          </div>
        </Card>
      )}

      {status && !authError && (
        <Card title="Fee sharing for a launched coin">
          <p className="text-sm text-[#6c757d]">
            After launching a property coin (or $DYNASTY) on Pump.fun from this wallet and registering its mint, lock its creator fees to the treasury
            vaults. The split comes from the registered wallets; it cannot be edited here.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={setupMint}
              onChange={(e) => setSetupMint(e.target.value)}
              placeholder="Coin mint address"
              aria-label="Coin mint address"
              className="min-w-0 flex-1 rounded border border-[#ced4da] px-2 py-1.5 font-mono text-xs"
            />
            <ActionButton label="Prepare" disabled={!wallet || setupMint.trim().length < 32} busy={busy === "setup"} onClick={feeSharingSetup} />
          </div>
        </Card>
      )}

      {status && !authError && (
        <Card title="Buybacks waiting for a proposal">
          {needsProposal.length === 0 ? (
            <p className="text-sm text-[#6c757d]">Nothing to propose. Buybacks appear here after they are planned, quoted and approved by admins.</p>
          ) : (
            <ul className="divide-y divide-[#dee2e6]">
              {needsProposal.map((b) => {
                const purpose = b.status === "APPROVED" ? "swap" : "burn";
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="font-semibold">{purpose === "swap" ? `Buy with ${formatSol(b.budgetLamports)}` : `Burn ${b.tokensReceivedRaw ?? "0"} raw units`}</span>
                    <span className="text-xs text-[#6c757d]">{b.status}</span>
                    <ActionButton
                      label={purpose === "swap" ? "Create buyback proposal" : "Create burn proposal"}
                      disabled={!canInit}
                      busy={busy === `propose-${b.id}`}
                      onClick={() => propose(b, purpose)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {status && !authError && (
        <Card title="Open proposals">
          {open.length === 0 ? (
            <p className="text-sm text-[#6c757d]">No proposals waiting for signatures.</p>
          ) : (
            <ul className="divide-y divide-[#dee2e6]">
              {open.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      #{p.transactionIndex} · {p.purpose === "SWAP" ? `Buy $DYNASTY with up to ${formatSol(p.amount)}` : `Burn ${formatTokenAmount(p.amount, null)} raw units`}
                    </p>
                    <p className="text-xs text-[#6c757d]">
                      {p.status === "PREPARED" ? "Prepared, not yet created on-chain" : `${p.approvals} of ${p.threshold} approvals · ${p.status.toLowerCase()}`} ·{" "}
                      <a className="text-d8-green hover:underline" href={solscan("account", p.proposalPda)} target="_blank" rel="noopener noreferrer">
                        proposal account
                      </a>
                    </p>
                  </div>
                  {p.status === "CREATED" && (
                    <>
                      <ActionButton label="Approve" disabled={!canVote} busy={busy === `approve-${p.id}`} onClick={() => memberAction(p, "approve")} />
                      <ActionButton label="Reject" variant="ghost" disabled={!canVote} busy={busy === `reject-${p.id}`} onClick={() => memberAction(p, "reject")} />
                    </>
                  )}
                  {p.status === "APPROVED" && <ActionButton label="Execute" disabled={!canExec} busy={busy === `execute-${p.id}`} onClick={() => memberAction(p, "execute")} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {status && !authError && done.length > 0 && (
        <Card title="Recent proposals">
          <ul className="space-y-1 text-xs text-[#495057]">
            {done.map((p) => (
              <li key={p.id}>
                #{p.transactionIndex} {p.purpose.toLowerCase()} · {p.status.toLowerCase()}
                {p.executedSignature && (
                  <>
                    {" · "}
                    <a className="text-d8-green hover:underline" href={solscan("tx", p.executedSignature)} target="_blank" rel="noopener noreferrer">
                      {shortAddress(p.executedSignature)}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {review && (
        <div role="dialog" aria-modal="true" aria-labelledby="review-title" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-md bg-white p-5 shadow-lg">
            <h2 id="review-title" className="flex items-center gap-2 text-lg font-bold">
              <ShieldCheck className="size-5 text-d8-green" aria-hidden /> {review.title}
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              {review.lines.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] tracking-wider text-[#868e96] uppercase">{k}</dt>
                  <dd className="break-all text-[#212529]">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-[#6c757d]">Phantom will show the transaction again. Only approve it there if it matches this summary.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setReview(null)} className="rounded border border-[#ced4da] px-3 py-1.5 text-sm font-semibold">
                Cancel
              </button>
              <button
                onClick={confirmAndSign}
                disabled={busy === "sign"}
                className="inline-flex items-center gap-2 rounded bg-d8-green px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === "sign" && <Loader2 className="size-4 animate-spin" aria-hidden />} Sign in Phantom
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  async function prepareSync() {
    setBusy("sync");
    setError(null);
    try {
      await api("/api/admin/demolition-fund/proposals", { method: "POST" });
      await load(wallet);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
}

const noopSubscribe = () => () => {};

function perms(m: Member) {
  return [m.initiate && "propose", m.vote && "vote", m.execute && "execute"].filter(Boolean).join(", ") || "no permissions";
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[#ced4da] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <header className="flex items-center justify-between gap-2 border-b border-[#dee2e6] px-4 py-2.5">
        <h2 className="text-sm font-bold text-[#212529]">{title}</h2>
        {action}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded bg-[#f8f9fa] px-2.5 py-2">
      <dt className="text-[10px] tracking-wider text-[#868e96] uppercase">{k}</dt>
      <dd className="mt-0.5 font-semibold">{v}</dd>
    </div>
  );
}

function Addr({ a }: { a: string }) {
  return (
    <a className="inline-flex items-center gap-1 font-mono text-xs text-d8-green hover:underline" href={solscan("account", a)} target="_blank" rel="noopener noreferrer" title={a}>
      {shortAddress(a)} <ExternalLink className="size-3" />
    </a>
  );
}

function ActionButton(p: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean; variant?: "ghost" }) {
  return (
    <button
      onClick={p.onClick}
      disabled={p.disabled || p.busy}
      title={p.disabled ? "Your connected wallet does not have this permission" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50",
        p.variant === "ghost" ? "border border-[#ced4da] text-[#495057]" : "bg-d8-green text-white hover:opacity-90",
      )}
    >
      {p.busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} {p.label}
    </button>
  );
}

function IconButton({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-d8-green hover:underline disabled:opacity-50">
      <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden /> {label}
    </button>
  );
}
