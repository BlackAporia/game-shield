// ─── GameShield rating points ────────────────────────────────────────────────
// Local-first scoring: volume, activity count, campaigns and streaks. The ledger
// lives in localStorage; points are a transparency metric, not a token.

export type PointsEvent = {
  ts: number;
  kind: "swap" | "campaign" | "fund" | "payout" | "shield" | "bridge";
  label: string;
  usd?: number;
  points: number;
};

export const LEVELS = [
  { name: "Bronze", min: 0 },
  { name: "Silver", min: 250 },
  { name: "Gold", min: 1000 },
  { name: "Platinum", min: 2500 },
  { name: "Diamond", min: 5000 },
] as const;

const KEY = "gameshield.points";

export function loadLedger(): PointsEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PointsEvent[]) : [];
  } catch {
    return [];
  }
}

function saveLedger(events: PointsEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(events.slice(-500)));
  } catch {
    /* ignore */
  }
}

export function recordPoints(ev: Omit<PointsEvent, "ts">): PointsEvent[] {
  const ledger = loadLedger();
  const entry: PointsEvent = { ...ev, ts: Date.now() };
  ledger.push(entry);
  saveLedger(ledger);
  return ledger;
}

export function computeStats(ledger: PointsEvent[]) {
  const byKind: Record<string, number> = {};
  let volumeUsd = 0;
  let swaps = 0;
  for (const ev of ledger) {
    byKind[ev.kind] = (byKind[ev.kind] ?? 0) + ev.points;
    if (ev.kind === "swap") {
      swaps++;
      volumeUsd += ev.usd ?? 0;
    }
  }
  const days = new Set(ledger.map((e) => new Date(e.ts).toDateString())).size;
  const streak = currentStreak(ledger);
  const base =
    (byKind.swap ?? 0) + (byKind.campaign ?? 0) + (byKind.fund ?? 0) + (byKind.payout ?? 0) + (byKind.shield ?? 0) + (byKind.bridge ?? 0);
  const streakBonus = streak * 10;
  const total = base + streakBonus;
  const level = LEVELS.filter((l) => total >= l.min).pop() ?? LEVELS[0];
  const next = LEVELS.find((l) => l.min > total);
  return {
    total,
    base,
    streakBonus,
    level: level.name,
    nextLevel: next?.name,
    toNext: next ? next.min - total : 0,
    swaps,
    volumeUsd,
    activeDays: days,
    streak,
  };
}

function currentStreak(ledger: PointsEvent[]): number {
  if (!ledger.length) return 0;
  const days = [...new Set(ledger.map((e) => new Date(e.ts).toDateString()))].sort();
  let streak = 1;
  for (let i = days.length - 1; i > 0; i--) {
    const prev = new Date(days[i - 1]);
    const cur = new Date(days[i]);
    const diff = Math.round((cur.getTime() - prev.getTime()) / 86_400_000);
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

// Points awarded per kind.
export const POINTS_PER = {
  swap: 25,
  campaign: 50,
  fund: 25,
  payout: 100,
  shield: 10,
  bridge: 10,
} as const;

export function swapPoints(usd: number): number {
  return POINTS_PER.swap + Math.min(75, Math.floor(usd / 5));
}