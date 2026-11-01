import { LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export function LoadingState() { return <div className="page-state"><LoaderCircle className="spin" size={28} /><p>Loading your SIS records…</p></div>; }
export function ErrorState({ message, onRetry, forbidden = false }: { message: string; onRetry?: () => void; forbidden?: boolean }) { return <div className="page-state error-state" role="alert"><TriangleAlert size={28} /><h2>{forbidden ? 'Access denied' : 'We could not load this page'}</h2><p>{message}</p>{onRetry && <button className="admin-secondary" onClick={onRetry}>Try again</button>}</div>; }
export function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) { return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="supporting-copy">{description}</p>}</div>{action}</div>; }
