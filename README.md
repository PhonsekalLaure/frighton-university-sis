# Frighton University SIS (Student Information System)

A modern Student Information System built for Frighton University with **React (TypeScript)**, **Node.js + Express (TypeScript)**, and **Supabase (PostgreSQL & Auth)**. Designed from the ground up for seamless bidirectional integration with the upcoming **Frighton University Library Management System (LMS)**.

---

## 🏗️ Architecture & Monorepo Structure

```
Frighton University SIS/
├── client/                     # React 19 + Vite (TypeScript) Frontend Portal
│   ├── src/
│   │   ├── config/             # Browser Supabase client & environment checks
│   │   ├── types/              # Domain entities (Profile, Course, Hold, etc.)
│   │   ├── App.tsx             # Main Dashboard & Architecture Hub
│   │   └── index.css           # Refined design system tokens & theme
│   ├── .env.example            # Frontend environment variable template
│   └── vite.config.ts          # Vite build config with backend proxy (/api)
│
├── server/                     # Node.js + Express (TypeScript) Backend API
│   ├── src/
│   │   ├── config/             # Supabase Admin / Anon clients & env configs
│   │   ├── middlewares/        # JWT auth verification, RBAC guards & error handlers
│   │   ├── routes/             # REST endpoints (healthcheck & LMS integration bridge)
│   │   ├── app.ts              # Express application setup
│   │   └── server.ts           # Entry point listener
│   ├── .env.example            # Backend environment variable template
│   └── tsconfig.json           # NodeNext TypeScript configuration
│
├── supabase/                   # Supabase SQL Migrations & Development Data
│   ├── migrations/
│   │   ├── 001_initial_schema.sql  # Profiles, courses, terms, sections, holds
│   │   └── 002_rls_policies.sql    # Row-Level Security (RLS) policies
│   └── seed.sql                    # Initial terms, courses, and sample sections
│
├── docs/                       # Architecture & Integration Contracts
│   └── lms-integration-spec.md # Library Management System integration spec
│
└── package.json                # Root orchestration scripts with npm workspaces
```

---

## 🚀 Quick Start

### 1. Install Dependencies
Run from the root directory to install packages across workspaces:
```bash
npm install
```

### 2. Configure Environment Variables
Copy the templates into active `.env` files:

- **Client**:
  ```bash
  cp client/.env.example client/.env
  ```
- **Server**:
  ```bash
  cp server/.env.example server/.env
  ```

### 3. Apply Supabase Migrations
When your Supabase project is created:
1. Open the **SQL Editor** in your Supabase Dashboard.
2. Execute `supabase/migrations/001_initial_schema.sql`.
3. Execute `supabase/migrations/002_rls_policies.sql`.
4. (Optional) Run `supabase/seed.sql` to populate sample academic courses and terms.
5. Add your Supabase project URL and keys to `client/.env` and `server/.env`.

### 4. Run Development Servers
Start both the React client (port `3000`) and Express server (port `5000`) simultaneously:
```bash
npm run dev
```

---

## 📚 Library Management System (LMS) Integration Bridge

The SIS backend provides dedicated integration endpoints ready for the LMS:

| Endpoint | Method | Purpose |
|:---|:---|:---|
| `/api/v1/integration/students/:frightonId/status` | `GET` | Verify if patron is in good standing and can borrow books |
| `/api/v1/integration/holds` | `POST` | Place a library hold on a student account (e.g. overdue materials) |
| `/api/v1/integration/holds/:holdId/resolve` | `POST` | Clear a library hold once returned/settled |

> All LMS requests authenticate using the `X-LMS-API-KEY` header. See [docs/lms-integration-spec.md](docs/lms-integration-spec.md) for full specifications.
