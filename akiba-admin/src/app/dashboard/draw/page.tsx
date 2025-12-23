// app/dashboard/draw/page.tsx
"use client";

import { useState } from "react";
import Card from "@/components/Card";
import { useDrawableRounds } from "@/hooks/useDrawableRounds";
import { usePublicClient, useWriteContract } from "wagmi";
import managerAbi from "@/lib/abi/AkibaV3.json";
import { RAFFLE_MANAGER } from "@/lib/raffle-contract";
import type { Hex } from "viem";

const badge = (t: number) => (t === 3 ? "Physical" : t === 2 ? "Top-5" : t === 1 ? "Top-3" : "Single");

export default function DrawPage() {
  const { data, isLoading, isError, refetch } = useDrawableRounds();
  const pc = usePublicClient();
  const { writeContractAsync, status } = useWriteContract();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function handleAction(id: number, fn: "drawWinner" | "closeRaffle", successMsg: string, failMsg: string) {
    try {
      setBusyId(id);
      const tx = await writeContractAsync({
        abi: managerAbi,
        address: RAFFLE_MANAGER,
        functionName: fn,
        args: [BigInt(id)],
      });
      await pc!.waitForTransactionReceipt({ hash: tx as Hex });
      await refetch();
      alert(`${successMsg} #${id}`);
    } catch (e: any) {
      alert(e?.shortMessage || e?.message || failMsg);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <Card title="Draw / Close">
        {isLoading ? (
          <p>Loading…</p>
        ) : isError ? (
          <p className="text-red-600">Failed to load raffles.</p>
        ) : (
          <div className="space-y-3">
            {(data || []).map((r) => {
              const endsLabel =
                r.endsIn <= 0 ? "Ended" :
                r.endsIn >= 86_400 ? `${Math.floor(r.endsIn / 86_400)}d` :
                `${Math.floor(r.endsIn / 3600)}h ${Math.floor((r.endsIn % 3600) / 60)}m`;

              const showRow = r.canDraw || r.canClose || (!r.drawn && !r.closed);
              if (!showRow) return null;

              const closing = busyId === r.id && !r.canDraw;
              const drawing = busyId === r.id && r.canDraw;

              return (
                <div key={r.id} className="rounded-lg border p-4 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      Raffle #{r.id}{" "}
                      <span className="ml-2 text-xs rounded bg-gray-200 px-2 py-0.5">{badge(r.raffleType)}</span>
                      <span className={`ml-2 text-xs rounded px-2 py-0.5 ${r.randRequested ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"}`}>
                        {r.randRequested ? "VRF requested" : "VRF not requested"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">
                      Tickets: {r.totalTickets}/{r.maxTickets}
                      {r.maxReached ? <span className="ml-1 text-green-600">Max reached</span> : null}
                      {" · "}Ends: {endsLabel}
                      {" · "}
                      {r.meetsThreshold ? <span className="text-green-700">10% threshold</span> : <span className="text-amber-700">&lt;10% threshold</span>}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                      disabled={!r.canClose || busyId === r.id || status === "pending"}
                      onClick={() => handleAction(r.id, "closeRaffle", "Closed & refunded", "Close failed")}
                      title="Refund all tickets to participants"
                    >
                      {closing ? "Closing…" : "Close & refund"}
                    </button>

                    <button
                      className="inline-flex items-center justify-center rounded-md bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
                      disabled={!r.canDraw || busyId === r.id || status === "pending"}
                      onClick={() => handleAction(r.id, "drawWinner", "Draw complete for round", "Draw failed")}
                    >
                      {drawing ? "Drawing…" : "Draw winner"}
                    </button>
                  </div>
                </div>
              );
            })}

            {(!data || data.length === 0) && <p className="text-gray-500">No raffles found.</p>}
          </div>
        )}
      </Card>
    </main>
  );
}
