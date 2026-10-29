import ConfirmButton from './ConfirmButton.jsx';

function Dot({ label, status }) {
  const on = status === 'online';
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      {label} <span className="text-slate-400">{status ?? 'unknown'}</span>
    </span>
  );
}

export default function PowerCard({ esp, pc, onPower }) {
  const pcOn = pc === 'online';
  return (
    <section className="card">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="card-title">Power</h2>
        <div className="flex gap-4">
          <Dot label="ESP32" status={esp} />
          <Dot label="PC" status={pc} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button type="button" className="btn btn-primary" disabled={pcOn || esp !== 'online'} onClick={() => onPower('wake')}>
          Wake
        </button>
        <button type="button" className="btn" disabled={!pcOn} onClick={() => onPower('sleep')}>
          Sleep
        </button>
        <button type="button" className="btn" disabled={!pcOn} onClick={() => onPower('hibernate')}>
          Hibernate
        </button>
        <ConfirmButton className="btn" label="Shutdown" disabled={!pcOn} onConfirm={() => onPower('shutdown')} />
      </div>
    </section>
  );
}
