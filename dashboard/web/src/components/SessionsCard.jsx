import ConfirmButton from './ConfirmButton.jsx';

export default function SessionsCard({ sessions, onStop }) {
  return (
    <section className="card">
      <div className="flex justify-between">
        <h2 className="card-title">Claude sessions</h2>
        <a className="text-sm text-sky-400 underline" href="https://claude.ai/code" target="_blank" rel="noreferrer">
          Open claude.ai/code
        </a>
      </div>
      {sessions.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">None running.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-800">
          {sessions.map((s) => (
            <li key={s.pid} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.folder}</div>
                <div className="text-xs text-slate-400">
                  <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5">{s.mode ?? 'default'}</span>
                  since {new Date(s.started * 1000).toLocaleTimeString()}
                </div>
              </div>
              <ConfirmButton className="btn shrink-0" label="Stop" onConfirm={() => onStop(s.pid)} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">
        One server per folder. Open more chats for a running folder from claude.ai/code; stop and restart to change mode.
      </p>
    </section>
  );
}
