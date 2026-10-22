import { BookOpenCheck, Clock3, ShieldCheck } from 'lucide-react';
import { SectionHeading } from '../components/PageStates';

export function LibraryPage() {
  return <><SectionHeading eyebrow="FRIGHTON UNIVERSITY LIBRARY" title="Library services" description="Your library self-service experience is being connected securely." />
    <section className="library-pending-card"><div className="library-pending-icon"><BookOpenCheck size={29} /></div><div><p className="eyebrow">COMING SOON</p><h2>Library self-service is not available yet</h2><p>The Library Management System is being connected to SIS. Catalog search, reservations, loans, due dates, and read-only fine information will appear here once that secure connection is ready.</p></div></section>
    <div className="library-preview-grid"><section className="content-card library-preview"><Clock3 size={21} className="card-icon" /><h2>Reservations and loans</h2><p>Book availability, Main Library pickup reservations, current loans, and due dates will remain managed by the Library Management System.</p></section><section className="content-card library-preview"><ShieldCheck size={21} className="card-icon" /><h2>Account restrictions</h2><p>Library debt may appear on your SIS Holds page. Holds are read-only here and can only be cleared by authorized university processes.</p></section></div>
  </>;
}
