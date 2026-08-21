const COLORS: Record<string, string> = {
  AVOID: "#f87171", // red-400
  CAUTION: "#facc15", // yellow-400
  LOWER_RISK: "#34d399", // emerald-400
};

export function ScoreDial({
  score,
  band,
}: {
  score: number | null;
  band: string | null;
}) {
  const unscored = score === null || band === null;
  const color = unscored ? "#71717a" : (COLORS[band] ?? "#71717a");
  const pct = unscored ? 0 : score / 100;
  const r = 54;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="relative h-36 w-36">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="#27272a"
          strokeWidth="10"
        />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {unscored ? (
          <span className="text-sm font-semibold text-zinc-400">Unscored</span>
        ) : (
          <span className="text-3xl font-bold" style={{ color }}>
            {score}
          </span>
        )}
        <span className="text-[10px] text-zinc-500">/ 100</span>
      </div>
    </div>
  );
}
