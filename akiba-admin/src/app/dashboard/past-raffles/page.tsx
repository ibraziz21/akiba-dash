// app/dashboard/past-raffles/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/Card';
import { Button } from '@/components/ui/button';

type PastRaffle = {
  roundId: number;
  start: number;
  end: number;
  durationSec: number;
  rewardToken: `0x${string}`;
  symbol: string;
  rewardPool: string;
  winner: string | null;
  winnerReward: string | null;
  winnerTs: number | null;
};

export default function PastRafflesPage() {
  const [data, setData]   = useState<PastRaffle[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]     = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/past-raffles')
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setData(json.raffles || []);
      })
      .catch(e => setErr(e.message || 'Failed'))
      .finally(() => setLoading(false));
  }, []);

  const shorten = (addr: string | null) =>
    addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';

  const fmtDur = (sec: number) => {
    const d = Math.floor(sec / 86400);
    sec -= d * 86400;
    const h = Math.floor(sec / 3600);
    sec -= h * 3600;
    const m = Math.floor(sec / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  if (loading) return <p className="p-6">Loading…</p>;
  if (err)     return <p className="p-6 text-red-500">{err}</p>;

  return (
    <main className="max-w-5xl mx-auto p-6">
      <Card title="Previous Raffles">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b">
              <tr>
                <th className="py-2 pr-4">Round</th>
                <th className="py-2 pr-4">Token</th>
                <th className="py-2 pr-4">Total Reward</th>
                <th className="py-2 pr-4">Duration</th>
                <th className="py-2 pr-4">Winner</th>
                <th className="py-2 pr-4">Won</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => (
                <tr key={r.roundId} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">#{r.roundId}</td>
                  <td className="py-2 pr-4">{r.symbol}</td>
                  <td className="py-2 pr-4">{r.rewardPool} {r.symbol}</td>
                  <td className="py-2 pr-4">{fmtDur(r.durationSec)}</td>
                  <td className="py-2 pr-4">{shorten(r.winner)}</td>
                  <td className="py-2 pr-4">
                    {r.winnerReward ? `${r.winnerReward} ${r.symbol}` : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    <a
                      className="text-[#238D9D] hover:underline"
                      href={`https://celoscan.io/address/${r.rewardToken}`}
                      target="_blank"
                    >
                      Token
                    </a>
                    {r.winner && (
                      <>
                        {' · '}
                        <a
                          className="text-[#238D9D] hover:underline"
                          href={`https://celoscan.io/address/${r.winner}`}
                          target="_blank"
                        >
                          Winner
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
