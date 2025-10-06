'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/components/Card';
import { gqlFetch } from '@/lib/subgraph';

/* ── GraphQL (v3 events only) ───────────────────────────────── */

type RC = {
  id: string;
  roundId: string;
  startTime?: string;
  endTime?: string;
  rewardToken?: string | null;
  rewardPool?: string;
  maxTickets?: string;
  ticketCostPoints?: string;
  roundType?: number | null; // v3
};
type WS  = { id: string; roundId: string; winner: string; reward: string };
type MWS = { id: string; roundId: string; winners: string[]; amounts: string[] };
type PJ  = { id: string; roundId: string; tickets: string };

type Gql = {
  roundCreateds: RC[];
  winnerSelecteds: WS[];
  multiWinnersSelecteds: MWS[];
  participantJoineds: PJ[];
};

const QUERY = /* GraphQL */ `
  query PastRaffles($first: Int!) {
    roundCreateds(first: $first, orderBy: roundId, orderDirection: desc) {
      id
      roundId
      startTime
      endTime
      rewardToken
      rewardPool
      maxTickets
      ticketCostPoints
      roundType
    }
    winnerSelecteds(first: $first, orderBy: roundId, orderDirection: desc) {
      id
      roundId
      winner
      reward
    }
    multiWinnersSelecteds(first: $first, orderBy: roundId, orderDirection: desc) {
      id
      roundId
      winners
      amounts
    }
    participantJoineds(first: 1000, orderBy: id, orderDirection: desc) {
      id
      roundId
      tickets
    }
  }
`;

/* ── Token meta + formatting ─────────────────────────────────── */

const TOKENS = {
  usdt: '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e',
  cusd: '0x765de816845861e75a25fca122bb6898b8b1282a',
  miles: '0xeed878017f027fe96316007d0ca5fda58ee93a6b',
} as const;

const SYMBOLS: Record<string, string> = {
  [TOKENS.usdt]: 'USDT',
  [TOKENS.cusd]: 'cUSD',
  [TOKENS.miles]: 'AkibaMiles',
};

const DECIMALS: Record<string, number> = {
  [TOKENS.usdt]: 6,
  [TOKENS.cusd]: 18,
  [TOKENS.miles]: 18,
};

const shortAddr = (a?: string) => (a && a.length > 12 ? `${a.slice(0,6)}…${a.slice(-4)}` : a || '—');

function formatUnits(raw?: string | null, decimals = 18): string {
  if (!raw) return '—';
  let s = BigInt(raw).toString();
  const neg = s.startsWith('-'); if (neg) s = s.slice(1);
  if (decimals === 0) return (neg ? '-' : '') + s;
  if (s.length <= decimals) s = '0'.repeat(decimals - s.length + 1) + s;
  const i = s.length - decimals;
  const whole = s.slice(0, i);
  const frac = s.slice(i).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return (neg ? '-' : '') + out.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtAmountWithSymbol(raw?: string, token?: string | null) {
  if (!token || token === '0x0000000000000000000000000000000000000000') return '—';
  const key = token.toLowerCase();
  const sym = SYMBOLS[key] || shortAddr(key);
  const dec = DECIMALS[key] ?? 18;
  return `${formatUnits(raw, dec)} ${sym}`;
}

const typeLabel = (t?: number | null) =>
  t === 3 ? 'Physical' : t === 2 ? 'Top-5' : t === 1 ? 'Top-3' : 'Single';

const fmtDur = (s?: string, e?: string) => {
  const start = Number(s || 0), end = Number(e || 0);
  const sec = Math.max(0, end - start);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
};

/* ── Row shape ───────────────────────────────────────────────── */

type Row = {
  roundId: number;
  startTime?: string;
  endTime?: string;
  rewardToken?: string | null;
  rewardPool?: string;
  maxTickets?: number;
  totalTickets?: number;
  roundType?: number | null;
  winners: { addr: string; amount?: string }[];
};

/* ── Component ───────────────────────────────────────────────── */

export default function PastRafflesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await gqlFetch<Gql>(QUERY, { first: 500 });

        // winners per round: prefer multi if present, else single
        const wmap = new Map<string, { addr: string; amount?: string }[]>();
        for (const e of d.winnerSelecteds || []) {
          wmap.set(e.roundId, [{ addr: e.winner, amount: e.reward }]);
        }
        for (const e of d.multiWinnersSelecteds || []) {
          const arr = (e.winners || []).map((w, i) => ({ addr: w, amount: e.amounts?.[i] }));
          if (arr.length) wmap.set(e.roundId, arr);
        }

        // ticket sums
        const tix = new Map<string, number>();
        for (const e of d.participantJoineds || []) {
          const n = Number(e.tickets || 0);
          tix.set(e.roundId, (tix.get(e.roundId) || 0) + (Number.isFinite(n) ? n : 0));
        }

        // Build rows for rounds that have ended or have winners
        const now = Math.floor(Date.now() / 1000);
        const out: Row[] = [];
        for (const r of d.roundCreateds || []) {
          const end = Number(r.endTime || 0);
          const hasWinners = wmap.has(r.roundId);
          const ended = end > 0 && now > end;

          if (!hasWinners && !ended) continue; // keep Past tab “past”

          const rt = Number(r.roundType ?? 0);
          const isPhysical = rt === 3;

          out.push({
            roundId: Number(r.roundId),
            startTime: r.startTime,
            endTime: r.endTime,
            rewardToken: isPhysical ? null : r.rewardToken,
            rewardPool: r.rewardPool,
            maxTickets: Number(r.maxTickets || 0) || undefined,
            totalTickets: tix.get(r.roundId) || 0,
            roundType: rt,
            winners: wmap.get(r.roundId) || [],
          });
        }

        // Already requested desc by roundId; keep it
        setRows(out);
      } catch (e: any) {
        setErr(e?.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const view = useMemo(() => rows, [rows]);

  if (loading) return <p className="p-6">Loading…</p>;
  if (err) return <p className="p-6 text-red-600">{err}</p>;

  return (
    <main className="max-w-6xl mx-auto p-6">
      <Card title="Previous Raffles">
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 border-b">
              <tr>
                <th className="py-2 px-3">Round</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Token</th>
                <th className="py-2 px-3">Total Reward</th>
                <th className="py-2 px-3">Duration</th>
                <th className="py-2 px-3">Winners</th>
              </tr>
            </thead>
            <tbody>
              {view.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-gray-500">No past raffles found.</td>
                </tr>
              ) : (
                view.map((r) => {
                  const isPhysical = r.roundType === 3;
                  const token = (r.rewardToken || '').toLowerCase();
                  const tokenLabel = isPhysical ? 'Physical' : (SYMBOLS[token] || shortAddr(token));
                  const totalReward = isPhysical ? '—' : fmtAmountWithSymbol(r.rewardPool, token);

                  return (
                    <tr key={r.roundId} className="border-b last:border-0 align-top">
                      <td className="py-2 px-3 font-medium">#{r.roundId}</td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                          {typeLabel(r.roundType)}
                        </span>
                      </td>
                      <td className="py-2 px-3">{tokenLabel}</td>
                      <td className="py-2 px-3 tabular-nums">{totalReward}</td>
                      <td className="py-2 px-3">{fmtDur(r.startTime, r.endTime)}</td>
                      <td className="py-2 px-3">
                        {r.winners.length ? (
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {r.winners.map((w, i) => {
                              const amt = isPhysical ? '' : fmtAmountWithSymbol(w.amount, token);
                              return (
                                <div key={w.addr + i} className="text-sm">
                                  <a
                                    className="text-[#238D9D] hover:underline"
                                    href={`https://celoscan.io/address/${w.addr}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {shortAddr(w.addr)}
                                  </a>
                                  {amt ? <span className="ml-2 text-gray-600 tabular-nums">{amt}</span> : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
