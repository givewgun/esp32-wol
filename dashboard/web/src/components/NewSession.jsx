import { useState } from 'react';

export const MODES = ['bypassPermissions', 'acceptEdits', 'auto', 'default', 'dontAsk', 'plan'];

export default function NewSession({ folders, sessions, online, busy, onStart }) {
  const running = new Set(sessions.map((s) => s.folder));
  const [folder, setFolder] = useState('');
  const [mode, setMode] = useState(MODES[0]);
  const choice = folder && !running.has(folder) ? folder : folders.find((f) => !running.has(f)) ?? '';

  return (
    <section className="card">
      <h2 className="card-title">New session</h2>
      <label className="mt-3 block text-sm text-slate-400" htmlFor="folder">
        Folder in workspace
      </label>
      <select
        id="folder"
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5"
        value={choice}
        onChange={(e) => setFolder(e.target.value)}
      >
        {folders.map((f) => (
          <option key={f} value={f} disabled={running.has(f)}>
            {running.has(f) ? `${f} (running)` : f}
          </option>
        ))}
      </select>
      <fieldset className="mt-3">
        <legend className="text-sm text-slate-400">Permission mode</legend>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label
              key={m}
              className={`cursor-pointer rounded-lg border p-2 text-center text-sm ${
                mode === m ? 'border-sky-400 bg-sky-400/10 text-sky-200' : 'border-slate-700'
              }`}
            >
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
              {m}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        className="btn btn-primary mt-4 w-full"
        disabled={!online || !choice || busy}
        onClick={() => onStart(choice, mode)}
      >
        {busy ? 'Starting…' : 'Start'}
      </button>
    </section>
  );
}
