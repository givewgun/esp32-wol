import { useState } from 'react';
import { post, useNow, useSnapshot } from './api.js';
import NewSession from './components/NewSession.jsx';
import PowerCard from './components/PowerCard.jsx';
import SessionsCard from './components/SessionsCard.jsx';
import StatsCard from './components/StatsCard.jsx';

export default function App() {
  const { snap, lost } = useSnapshot();
  const now = useNow();
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (label, path, body) => {
    setBusy(true);
    const res = await post(path, body);
    setBusy(false);
    setNotice(res.ok ? { ok: true, text: `${label}: done` } : { ok: false, text: `${label}: ${res.error}` });
    return res;
  };

  if (!snap) {
    return <main className="mx-auto max-w-3xl p-4 text-slate-400">{lost ? <Reload /> : 'Connecting…'}</main>;
  }

  const online = snap.pc === 'online';
  const sessions = snap.sessions?.sessions ?? [];
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">PC dashboard</h1>
      {lost && <Reload />}
      {notice && (
        <button
          type="button"
          onClick={() => setNotice(null)}
          className={`rounded-lg p-3 text-left text-sm ${notice.ok ? 'bg-emerald-900/50 text-emerald-200' : 'bg-rose-900/50 text-rose-200'}`}
        >
          {notice.text}
        </button>
      )}
      <PowerCard esp={snap.esp} pc={snap.pc} onPower={(action) => run(action, '/api/power', { action })} />
      <StatsCard stats={snap.stats} pc={snap.pc} now={now} />
      <SessionsCard sessions={sessions} onStop={(pid) => run('Stop', `/api/sessions/${pid}/stop`)} />
      <NewSession
        folders={snap.folders}
        sessions={sessions}
        online={online}
        busy={busy}
        onStart={(folder, mode) => run(`Start ${folder}`, '/api/sessions', { folder, mode })}
        onTrust={(folder) => run(`Trust ${folder}`, '/api/folders/trust', { folder })}
        onCreate={(folder, git) => run(`Create ${folder}`, '/api/folders', { folder, git })}
      />
    </main>
  );
}

function Reload() {
  return (
    <button type="button" className="btn w-full" onClick={() => window.location.reload()}>
      Connection lost. Tap to reload (you may need to sign in again).
    </button>
  );
}
