import { useState, useEffect } from 'react';
import './App.css';
import { isSupabaseConfigured } from './config/supabase';
import { 
  Database, 
  Server, 
  ShieldCheck, 
  Activity, 
  Terminal,
  Library,
  GraduationCap
} from 'lucide-react';

interface BackendHealth {
  status: string;
  service: string;
  timestamp: string;
}

export function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'schema' | 'lms' | 'setup'>('overview');
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [backendLoading, setBackendLoading] = useState(true);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error('Backend offline');
        return res.json();
      })
      .then((data: BackendHealth) => {
        setBackendHealth(data);
        setBackendLoading(false);
      })
      .catch(() => {
        setBackendHealth(null);
        setBackendLoading(false);
      });
  }, []);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-crest">
            <GraduationCap size={28} color="#fff" />
          </div>
          <div>
            <h1 className="brand-title">Frighton University SIS</h1>
            <p className="brand-subtitle">Student Information System & Academic Gateway</p>
          </div>
        </div>

        <div className="status-badges">
          <div className="badge">
            <span className={`badge-dot ${backendHealth ? 'online' : 'pending'}`}></span>
            <span>API Server: {backendLoading ? 'Checking...' : backendHealth ? 'Connected' : 'Offline'}</span>
          </div>

          <div className="badge">
            <span className={`badge-dot ${isSupabaseConfigured ? 'online' : 'pending'}`}></span>
            <span>Supabase: {isSupabaseConfigured ? 'Configured' : 'Credentials Needed'}</span>
          </div>

          <div className="badge">
            <span className="badge-dot integration"></span>
            <span>LMS Bridge: Active</span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tabs-nav">
        <button 
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Activity size={18} /> Architecture Overview
        </button>
        <button 
          className={`tab-btn ${activeTab === 'schema' ? 'active' : ''}`}
          onClick={() => setActiveTab('schema')}
        >
          <Database size={18} /> Database & Schemas
        </button>
        <button 
          className={`tab-btn ${activeTab === 'lms' ? 'active' : ''}`}
          onClick={() => setActiveTab('lms')}
        >
          <Library size={18} /> Library (LMS) Integration Hub
        </button>
        <button 
          className={`tab-btn ${activeTab === 'setup' ? 'active' : ''}`}
          onClick={() => setActiveTab('setup')}
        >
          <ShieldCheck size={18} /> Supabase Setup Guide
        </button>
      </nav>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <section>
          <div className="callout">
            <p>
              <strong>Architecture Status:</strong> Monorepo scaffolded with React (Vite) + Express (TypeScript). 
              Connected to Supabase PostgreSQL with Row Level Security and a server-to-server LMS integration boundary.
            </p>
          </div>

          <div className="cards-grid">
            <div className="card">
              <h2 className="card-title"><Server size={20} color="#8b5cf6" /> Node.js & Express API</h2>
              <p className="card-description">
                TypeScript REST backend running on port 5000 with JWT middleware, role validation, and CORS protection.
              </p>
              <div className="code-block">
                GET /api/health<br />
                GET /api/v1/dashboard/me<br />
                GET /api/v1/integration/students/:id/status<br />
                POST /api/v1/integration/holds
              </div>
            </div>

            <div className="card">
              <h2 className="card-title"><Database size={20} color="#38bdf8" /> Supabase & PostgreSQL</h2>
              <p className="card-description">
                Relational schema for academic terms, courses, section assignments, billing, and student holds with strict RLS.
              </p>
              <div className="code-block">
                supabase/migrations/20261020154411_sis_student_admin_portal_schema.sql<br />
                supabase/migrations/20261020155029_sis_link_profiles_to_shared_users.sql<br />
                supabase/migrations/20261021140908_rename_frighton_id_to_student_number.sql
              </div>
            </div>

            <div className="card">
              <h2 className="card-title"><Library size={20} color="#10b981" /> Library System Bridge</h2>
              <p className="card-description">
                Pre-configured contract ready to integrate with Frighton University's upcoming Library Management System.
              </p>
              <div className="code-block">
                docs/lms-integration-spec.md<br />
                Header: X-LMS-API-KEY<br />
                Hold type: library_debt
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Tab: Schema */}
      {activeTab === 'schema' && (
        <section>
          <div className="card">
            <h2 className="card-title"><Database size={20} color="#8b5cf6" /> SIS Database Tables</h2>
            <p className="card-description">
              These tables are applied to the SIS Supabase project and protected by RLS.
            </p>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Key Columns</th>
                  <th>Role / Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>profiles</code></td>
                  <td>id, student_number, first_name, last_name, role, academic_status</td>
                  <td>SIS academic profiles linked to the shared university user directory (students and admins)</td>
                </tr>
                <tr>
                  <td><code>academic_terms</code></td>
                  <td>id, code, name, start_date, end_date, is_active</td>
                  <td>Semesters and terms (e.g. Fall 2026, Spring 2027)</td>
                </tr>
                <tr>
                  <td><code>courses</code></td>
                  <td>id, course_code, title, credits, department</td>
                  <td>Master academic course catalog</td>
                </tr>
                <tr>
                  <td><code>course_sections</code></td>
                  <td>id, course_id, term_id, instructor_name, instructor_email, schedule, room</td>
                  <td>Offered course sections and their published timetable</td>
                </tr>
                <tr>
                  <td><code>academic_records</code></td>
                  <td>id, student_id, section_id, grade, is_current</td>
                  <td>Student transcript and current schedule assignments</td>
                </tr>
                <tr>
                  <td><code>student_holds</code></td>
                  <td>id, student_id, hold_type, reason, placed_by_system, resolved_at</td>
                  <td>Holds and clearance restrictions (e.g., library fines, debt)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab: LMS Integration */}
      {activeTab === 'lms' && (
        <section>
          <div className="card">
            <h2 className="card-title"><Library size={20} color="#38bdf8" /> Library Management System (LMS) Bridge Tester</h2>
            <p className="card-description">
              The LMS calls <code>GET /api/v1/integration/students/:studentNumber/status</code> and the hold endpoints from its server using <code>X-LMS-API-KEY</code>. The key is deliberately never available to browser code.
            </p>
          </div>
        </section>
      )}

      {/* Tab: Setup Guide */}
      {activeTab === 'setup' && (
        <section>
          <div className="card">
            <h2 className="card-title"><Terminal size={20} color="#10b981" /> Connecting Your Supabase Project</h2>
            <p className="card-description">
              The SIS project is already linked. Configure the local environment with the project credentials before running the API:
            </p>

            <ol style={{ paddingLeft: '1.25rem', color: 'var(--text-muted)', lineHeight: '1.8' }}>
              <li>
                Apply the ordered migrations in <code>supabase/migrations/</code> to an empty development project, or use the existing SIS project.
                <ul style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <li><code>20261020154411_sis_student_admin_portal_schema.sql</code></li>
                  <li><code>20261020155029_sis_link_profiles_to_shared_users.sql</code></li>
                  <li><code>20261021140908_rename_frighton_id_to_student_number.sql</code></li>
                </ul>
              </li>
              <li>
                Copy your <strong>Project URL</strong> and <strong>API Keys</strong> into:
                <ul style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <li><code>client/.env</code> (URL + Anon Key)</li>
                  <li><code>server/.env</code> (URL + Anon Key + Service Role Key)</li>
                </ul>
              </li>
              <li>
                Run <code>npm run dev</code> from the root directory to launch the unified development server.
              </li>
            </ol>
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
