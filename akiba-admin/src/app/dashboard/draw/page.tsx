// app/dashboard/draw/page.tsx
'use client';

import { useState } from 'react';
import Card from '@/components/Card';
import { useDrawableRounds } from '@/hooks/useDrawableRounds';
import { usePublicClient, useWriteContract } from 'wagmi';
import managerAbi from '@/lib/abi/AkibaV3.json';
import { RAFFLE_MANAGER } from '@/lib/raffle-contract';
import type { Hex } from 'viem';

const badge = (t: number) => (t === 3 ? 'Physical' : t === 2 ? 'Top-5' : t === 1 ? 'Top-3' : 'Single');

export default function DrawPage() {
  const { data, isLoading, isError, refetch } = useDrawableRounds();
  const pc = usePublicClient();
  const { writeContractAsync, status } = useWriteContract();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function onDraw(id: number) {
    try {
      setBusyId(id);
      const tx = await writeContractAsync({
        abi: managerAbi,
        address: RAFFLE_MANAGER,
        functionName: 'drawWinner',
        args: [BigInt(id)],
      });
      await pc!.waitForTransactionReceipt({ hash: tx as Hex });
      await refetch();
      alert(`Draw complete for round #${id}`);
    } catch (e: any) {
      alert(e?.shortMessage || e?.message || 'Draw failed');
    } finally {
      setBusyId(null);
    }
  }

  async function onClose(id: number) {
    try {
      setBusyId(id);
      const tx = await writeContractAsync({
        abi: managerAbi,
        address: RAFFLE_MANAGER,
        functionName: 'closeRaffle',
        args: [BigInt(id)],
      });
      await pc!.waitForTransactionReceipt({ hash: tx as Hex });
      await refetch();
      alert(`Round #${id} closed and refunds minted.`);
    } catch (e: any) {
      alert(e?.shortMessage || e?.message || 'Close failed');
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
                r.endsIn <= 0
                  ? 'Ended'
                  : r.endsIn >= 86_400
                  ? `${Math.floor(r.endsIn / 86_400)}d`
                  : `${Math.floor(r.endsIn / 3600)}h ${Math.floor((r.endsIn % 3600) / 60)}m`;

              // Show a row if either action is possible (or show disabled actions for clarity)
              const showRow = r.canDraw || r.canClose || (!r.drawn && !r.closed);
              if (!showRow) return null;

              return (
                <div key={r.id} className="rounded-lg border p-4 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      Raffle #{r.id}{' '}
                      <span className="ml-2 text-xs rounded bg-gray-200 px-2 py-0.5">
                        {badge(r.raffleType)}
                      </span>
                      {r.randRequested ? (
                        <span className="ml-2 text-xs rounded bg-blue-100 text-blue-700 px-2 py-0.5">
                          VRF requested
                        </span>
                      ) : (
                        <span className="ml-2 text-xs rounded bg-yellow-100 text-yellow-700 px-2 py-0.5">
                          VRF not requested
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      Tickets: {r.totalTickets}/{r.maxTickets}
                      {r.maxReached ? <span className="ml-1 text-green-600">Max reached</span> : null}
                      {' · '}Ends: {endsLabel}
                      {' · '}
                      {r.meetsThreshold ? (
                        <span className="text-green-700">≥20% threshold</span>
                      ) : (
                        <span className="text-amber-700">&lt;20% threshold</span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Close & refund: ended, <20%, not drawn/closed */}
                    <button
                      className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                      disabled={!r.canClose || busyId === r.id || status === 'pending'}
                      onClick={() => onClose(r.id)}
                      title="Refund all tickets to participants"
                    >
                      {busyId === r.id && !r.canDraw ? 'Closing…' : 'Close & refund'}
                    </button>

                    {/* Draw winner: ended/maxed, >=20%, not drawn/closed, VRF requested */}
                    <button
                      className="inline-flex items-center justify-center rounded-md bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
                      disabled={!r.canDraw || busyId === r.id || status === 'pending'}
                      onClick={() => onDraw(r.id)}
                    >
                      {busyId === r.id && r.canDraw ? 'Drawing…' : 'Draw winner'}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {(!data || data.length === 0) && (
              <p className="text-gray-500">No raffles found.</p>
            )}
          </div>
        )}
      </Card>
    </main>
  );
}
