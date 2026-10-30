import { isStale } from '../api.js';

const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;

function uptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function Stat({ label, value, pct }) {
  return (
    <div className="rounded-lg bg-slate-800/60 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {pct != null && (
        <div className="mt-2 h-1.5 rounded bg-slate-700">
          <div className="h-1.5 rounded bg-sky-400" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
      )}
    </div>
  );
}

export default function StatsCard({ stats, pc, now }) {
  const stale = isStale(stats, pc, now);
  return (
    <section className={`card ${stale ? 'opacity-50' : ''}`}>
      <div className="flex justify-between">
        <h2 className="card-title">{stats?.host ?? 'PC'}</h2>
        <span className="text-sm text-slate-400">
          {!stats ? 'no data yet' : stale ? `last seen ${new Date(stats.ts * 1000).toLocaleString()}` : `up ${uptime(stats.uptime_s)}`}
        </span>
      </div>
      {stats && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="CPU" value={`${Math.round(stats.cpu_pct)}%`} pct={stats.cpu_pct} />
          <Stat label="RAM" value={`${gb(stats.ram.used)} / ${gb(stats.ram.total)}`} pct={(stats.ram.used / stats.ram.total) * 100} />
          {stats.gpu ? (
            <>
              <Stat label="GPU" value={`${stats.gpu.util_pct}% · ${stats.gpu.temp_c}°C`} pct={stats.gpu.util_pct} />
              <Stat
                label="VRAM"
                value={`${(stats.gpu.vram_used_mb / 1024).toFixed(1)} / ${(stats.gpu.vram_total_mb / 1024).toFixed(0)} GB`}
                pct={(stats.gpu.vram_used_mb / stats.gpu.vram_total_mb) * 100}
              />
            </>
          ) : (
            <Stat label="GPU" value="n/a" />
          )}
          {stats.disks.map((d) => (
            <Stat key={d.mount} label={`Disk ${d.mount}`} value={`${gb(d.free)} free`} pct={((d.total - d.free) / d.total) * 100} />
          ))}
        </div>
      )}
    </section>
  );
}
