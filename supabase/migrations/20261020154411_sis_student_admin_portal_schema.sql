-- ============================================================
-- Frighton University SIS: student and administrator portal
-- No registration, enrollment, waitlist, or instructor/registrar roles.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE public.sis_user_role AS ENUM ('student', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.academic_status AS ENUM ('active', 'probation', 'suspended', 'graduated', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.hold_type AS ENUM ('library_debt', 'academic_probation', 'financial_delinquency', 'disciplinary');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.account_status AS ENUM ('open', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Login authorization stays in the shared public.users table. This table holds
-- SIS-only academic details; accounts are provisioned by an administrator.
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES public.users(users_id) ON DELETE CASCADE,
  frighton_id VARCHAR(50) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  role public.sis_user_role NOT NULL DEFAULT 'student',
  academic_status public.academic_status NOT NULL DEFAULT 'active',
  department VARCHAR(100),
  program VARCHAR(150),
  year_level SMALLINT CHECK (year_level BETWEEN 1 AND 4),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_profiles_frighton_id ON public.profiles(frighton_id);
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_email ON public.profiles(email);

CREATE TABLE public.academic_terms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (end_date >= start_date)
);

CREATE TABLE public.courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_code VARCHAR(20) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  credits SMALLINT NOT NULL CHECK (credits > 0),
  department VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_courses_code ON public.courses(course_code);

-- Administrative schedule catalog; no capacity or registration state is kept.
CREATE TABLE public.course_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  term_id UUID NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  section_number VARCHAR(10) NOT NULL DEFAULT '01',
  instructor_name VARCHAR(200),
  instructor_email VARCHAR(255),
  schedule VARCHAR(100),
  room VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(course_id, term_id, section_number)
);

-- Administrative transcript and schedule assignments; this is not enrollment.
CREATE TABLE public.academic_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES public.course_sections(id) ON DELETE RESTRICT,
  grade VARCHAR(5),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(student_id, section_id),
  CHECK (grade IS NULL OR grade IN ('A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F', 'IP', 'W'))
);

CREATE INDEX idx_academic_records_student ON public.academic_records(student_id);
CREATE INDEX idx_academic_records_section ON public.academic_records(section_id);

CREATE TABLE public.student_holds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hold_type public.hold_type NOT NULL,
  reason TEXT NOT NULL,
  placed_by_system VARCHAR(100) NOT NULL DEFAULT 'Frighton SIS',
  placed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_student_holds_student ON public.student_holds(student_id);
CREATE INDEX idx_student_holds_active ON public.student_holds(student_id) WHERE resolved_at IS NULL;

-- A balance snapshot per student and term; payments are stored separately.
CREATE TABLE public.student_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  base_tuition NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (base_tuition >= 0),
  mandatory_fees NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (mandatory_fees >= 0),
  scholarships NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (scholarships >= 0),
  status public.account_status NOT NULL DEFAULT 'open',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(student_id, term_id)
);

CREATE INDEX idx_student_accounts_student ON public.student_accounts(student_id);
CREATE INDEX idx_student_accounts_term ON public.student_accounts(term_id);

CREATE TABLE public.student_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.student_accounts(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  reference_number VARCHAR(100) UNIQUE NOT NULL,
  receipt_status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (receipt_status IN ('pending', 'completed', 'void')),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_student_payments_account ON public.student_payments(account_id);

CREATE SCHEMA IF NOT EXISTS private;

-- Private helpers prevent recursive public.profiles RLS policies and map the
-- authenticated Supabase email to the shared LMS/SIS account ID.
CREATE FUNCTION private.current_sis_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT users_id
  FROM public.users
  WHERE lower(email) = lower(COALESCE(auth.jwt()->>'email', ''))
  LIMIT 1;
$$;

CREATE FUNCTION private.is_sis_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = private.current_sis_user_id() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION private.is_sis_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_sis_user_id() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_sis_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_sis_user_id() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students view their own profile" ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT private.current_sis_user_id()) = id);
CREATE POLICY "Admins view all profiles" ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT private.is_sis_admin()));
CREATE POLICY "Admins update profiles" ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT private.is_sis_admin())) WITH CHECK ((SELECT private.is_sis_admin()));

CREATE POLICY "Users view academic terms" ON public.academic_terms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users view active courses" ON public.courses FOR SELECT TO authenticated
  USING (is_active OR (SELECT private.is_sis_admin()));
CREATE POLICY "Users view course sections" ON public.course_sections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users view their academic records" ON public.academic_records FOR SELECT TO authenticated
  USING ((SELECT private.current_sis_user_id()) = student_id OR (SELECT private.is_sis_admin()));
CREATE POLICY "Users view their holds" ON public.student_holds FOR SELECT TO authenticated
  USING ((SELECT private.current_sis_user_id()) = student_id OR (SELECT private.is_sis_admin()));
CREATE POLICY "Users view their accounts" ON public.student_accounts FOR SELECT TO authenticated
  USING ((SELECT private.current_sis_user_id()) = student_id OR (SELECT private.is_sis_admin()));
CREATE POLICY "Users view their payments" ON public.student_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.student_accounts account
    WHERE account.id = student_payments.account_id
      AND (account.student_id = (SELECT private.current_sis_user_id()) OR (SELECT private.is_sis_admin()))
  ));

CREATE POLICY "Admins manage academic terms" ON public.academic_terms FOR ALL TO authenticated
  USING ((SELECT private.is_sis_admin())) WITH CHECK ((SELECT private.is_sis_admin()));
CREATE POLICY "Admins manage courses" ON public.courses FOR ALL TO authenticated
  USING ((SELECT private.is_sis_admin())) WITH CHECK ((SELECT private.is_sis_admin()));
CREATE POLICY "Admins manage course sections" ON public.course_sections FOR ALL TO authenticated
  USING ((SELECT private.is_sis_admin())) WITH CHECK ((SELECT private.is_sis_admin()));
CREATE POLICY "Admins manage academic records" ON public.academic_records FOR ALL TO authenticated
  USING ((SELECT private.is_sis_admin())) WITH CHECK ((SELECT private.is_sis_admin()));
CREATE POLICY "Admins manage student holds" ON public.student_holds FOR ALL TO authenticated
  USING ((SELECT private.is_sis_admin())) WITH CHECK ((SELECT private.is_sis_admin()));
CREATE POLICY "Admins manage student accounts" ON public.student_accounts FOR ALL TO authenticated
  USING ((SELECT private.is_sis_admin())) WITH CHECK ((SELECT private.is_sis_admin()));
CREATE POLICY "Admins manage student payments" ON public.student_payments FOR ALL TO authenticated
  USING ((SELECT private.is_sis_admin())) WITH CHECK ((SELECT private.is_sis_admin()));
