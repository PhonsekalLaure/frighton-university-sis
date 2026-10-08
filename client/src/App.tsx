import { useState, useEffect } from 'react';
import './App.css';
import { isSupabaseConfigured } from './config/supabase';
import { 
  Database, 
  Server, 
  ShieldCheck, 
  Activity, 
  ArrowRight,
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
  const [testId, setTestId] = useState('STU-2026-0001');
  const [integrationResult, setIntegrationResult] = useState<string | null>(null);
  const [testingEndpoint, setTestingEndpoint] = useState(false);

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

  const handleTestLmsCheck = async () => {
    setTestingEndpoint(true);
    setIntegrationResult(null);
    try {
      const response = await fetch(`/api/v1/integration/students/${testId}/status`, {
        headers: {
          'x-lms-api-key': 'frighton-lms-sis-shared-secret-key-change-in-prod'
        }
      });
      const data = await response.json();
      setIntegrationResult(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      setIntegrationResult(JSON.stringify({ error: err instanceof Error ? err.message : 'Request failed' }, null, 2));
    } finally {
      setTestingEndpoint(false);
    }
  };

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
              Prepared for Supabase PostgreSQL database connection, Row Level Security, and bidirectional LMS integration.
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
                GET /api/v1/integration/students/:id/status<br />
                POST /api/v1/integration/holds
              </div>
            </div>

            <div className="card">
              <h2 className="card-title"><Database size={20} color="#38bdf8" /> Supabase & PostgreSQL</h2>
              <p className="card-description">
                Relational schema designed for academic terms, courses, sections, enrollments, and student holds with strict RLS.
              </p>
              <div className="code-block">
                supabase/migrations/001_initial_schema.sql<br />
                supabase/migrations/002_rls_policies.sql<br />
                supabase/seed.sql
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
            <h2 className="card-title"><Database size={20} color="#8b5cf6" /> Ready-to-Apply Database Tables</h2>
            <p className="card-description">
              These tables are fully scripted in <code>supabase/migrations/001_initial_schema.sql</code> and protected by RLS in <code>002_rls_policies.sql</code>.
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
                  <td>id, frighton_id, first_name, last_name, role, academic_status</td>
                  <td>Users linked 1:1 with Supabase Auth (students, instructors, admins)</td>
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
                  <td>id, course_id, term_id, instructor_id, schedule, room, capacity</td>
                  <td>Offered classes in specific terms with instructor assignments</td>
                </tr>
                <tr>
                  <td><code>enrollments</code></td>
                  <td>id, student_id, section_id, status, grade</td>
                  <td>Student class registration and grade tracking</td>
                </tr>
                <tr>
                  <td><code>student_holds</code></td>
                  <td>id, student_id, hold_type, reason, placed_by_system, resolved_at</td>
                  <td>Holds blocking enrollment or graduation (e.g., library fines, debt)</td>
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
              Test how the Library Management System interacts with the SIS API to query patron eligibility or place/resolve borrowing holds.
            </p>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
              <input 
                type="text" 
                value={testId} 
                onChange={(e) => setTestId(e.target.value)}
                placeholder="Enter Frighton ID (e.g. STU-2026-0001)"
                style={{
                  background: '#05070a',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.9rem',
                  flex: 1
                }}
              />
              <button 
                className="action-btn"
                onClick={handleTestLmsCheck}
                disabled={testingEndpoint}
              >
                {testingEndpoint ? 'Querying...' : 'Query Patron Status'} <ArrowRight size={16} />
              </button>
            </div>

            {integrationResult && (
              <div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Response from <code>GET /api/v1/integration/students/{testId}/status</code>:
                </p>
                <pre className="code-block" style={{ maxHeight: '250px' }}>
                  {integrationResult}
                </pre>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tab: Setup Guide */}
      {activeTab === 'setup' && (
        <section>
          <div className="card">
            <h2 className="card-title"><Terminal size={20} color="#10b981" /> Connecting Your Supabase Project</h2>
            <p className="card-description">
              When you are ready to create your Supabase project, follow these simple steps to link it:
            </p>

            <ol style={{ paddingLeft: '1.25rem', color: 'var(--text-muted)', lineHeight: '1.8' }}>
              <li>
                Visit <strong style={{ color: '#fff' }}>supabase.com</strong> and create a new project called <code>Frighton University SIS</code>.
              </li>
              <li>
                In the Supabase Dashboard, open the <strong style={{ color: '#fff' }}>SQL Editor</strong>.
              </li>
              <li>
                Copy and run the contents of:
                <ul style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <li><code>supabase/migrations/001_initial_schema.sql</code></li>
                  <li><code>supabase/migrations/002_rls_policies.sql</code></li>
                  <li><code>supabase/seed.sql</code></li>
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
