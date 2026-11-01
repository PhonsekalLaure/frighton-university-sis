import { useEffect, useState } from 'react';

export function useCooldown() {
  const [clock, setClock] = useState({ until: 0, now: 0 });
  const remaining = Math.max(0, Math.ceil((clock.until - clock.now) / 1000));
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setInterval(() => setClock(value => ({ ...value, now: Date.now() })), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);
  function wait(seconds?: number) {
    if (seconds && seconds > 0) {
      const now = Date.now();
      setClock(value => ({ until: Math.max(value.until, now + seconds * 1000), now }));
    }
  }
  return { remaining, wait };
}
