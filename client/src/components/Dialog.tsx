import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, busy = false, onClose, restoreFocusTo, children }: { title: string; busy?: boolean; onClose: () => void; restoreFocusTo?: HTMLElement | null; children: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const previous = restoreFocusTo ?? document.activeElement as HTMLElement | null;
    const element = panel.current!;
    const focusable = () => [...element.querySelectorAll<HTMLElement>('*')].filter(item => item.matches('button, input, select, textarea, summary, [tabindex]') && !item.matches(':disabled') && !item.closest('[hidden]') && item.tabIndex >= 0);
    (focusable()[0] ?? element).focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); if (!busyRef.current) closeRef.current(); }
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); element.focus(); }
        else if (!element.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, [restoreFocusTo]);
  return <div className="modal-backdrop"><section ref={panel} className="admin-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={19} /></button></div>{children}</section></div>;
}
