import { useState } from 'react';
import { MODES, isValidNewName } from '../../../server/validate.js';
import ConfirmButton from './ConfirmButton.jsx';

export default function NewSession({ folders, sessions, online, busy, onStart, onTrust, onCreate }) {
  const running = new Set(sessions.map((s) => s.folder));
  const [folder, setFolder] = useState('');
  const [mode, setMode] = useState(MODES[0]);
  const [newName, setNewName] = useState('');
  const [git, setGit] = useState(true);
  const names = folders.map((f) => f.name);
  const choice = names.includes(folder) && !running.has(folder) ? folder : (names.find((n) => !running.has(n)) ?? '');
  const selected = folders.find((f) => f.name === choice);
  const nameOk = isValidNewName(newName) && !names.some((n) => n.toLowerCase() === newName.toLowerCase());

  const create = async () => {
    const res = await onCreate(newName, git);
    if (res?.ok) {
      setFolder(newName); // selected as soon as the PC's folder list includes it
      setNewName('');
    }
  };

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
          <option key={f.name} value={f.name} disabled={running.has(f.name)}>
            {f.name}
            {running.has(f.name) ? ' (running)' : f.trusted ? '' : ' (untrusted)'}
          </option>
        ))}
      </select>
      {selected && !selected.trusted && (
        <div className="mt-3 rounded-lg border border-amber-700/60 bg-amber-900/20 p-3 text-sm text-amber-100">
          <p>
            Claude Code has not trusted this folder yet. Trusting it lets sessions read, edit and run files here, and
            applies the folder&apos;s project settings (hooks, MCP servers, permission rules, helper commands).
          </p>
          <ConfirmButton className="btn mt-2 w-full" label="Trust folder" disabled={!online || busy} onConfirm={() => onTrust(choice)} />
        </div>
      )}
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
        disabled={!online || !selected?.trusted || busy}
        onClick={() => onStart(choice, mode)}
      >
        {busy ? 'Working…' : 'Start'}
      </button>

      <div className="mt-5 border-t border-slate-800 pt-4">
        <label className="block text-sm text-slate-400" htmlFor="new-folder">
          New folder name
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="new-folder"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 p-2.5"
            placeholder="my-new-project"
            value={newName}
            maxLength={64}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setNewName(e.target.value.trim())}
          />
          <button type="button" className="btn shrink-0" disabled={!online || !nameOk || busy} onClick={create}>
            Create
          </button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} /> git init
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Letters, digits, - _ . (max 64). Created in workspace and trusted, ready to start.
        </p>
      </div>
    </section>
  );
}
