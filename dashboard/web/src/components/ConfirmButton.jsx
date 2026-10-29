import { useEffect, useState } from 'react';

// Two-tap button for destructive actions: first tap arms it for 3 s, second tap fires. No window.confirm on phones.
export default function ConfirmButton({ label, onConfirm, disabled, className = '' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const click = () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    onConfirm();
  };

  return (
    <button type="button" disabled={disabled} onClick={click} className={`${className} ${armed ? 'btn-danger' : ''}`}>
      {armed ? 'Tap again to confirm' : label}
    </button>
  );
}
