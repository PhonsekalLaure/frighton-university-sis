import { LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export function LoadingState() { return <div className="page-state"><LoaderCircle className="spin" size={28} /><p>Loading your SIS records…</p></div>; }
export function ErrorState({ message }: { message: string }) { return <div className="page-state error-state"><TriangleAlert size={28} /><h2>We could not load this page</h2><p>{message}</p></div>; }
export function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) { return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="supporting-copy">{description}</p>}</div>{action}</div>; }
