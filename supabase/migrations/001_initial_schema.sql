-- ============================================================
-- Frighton University SIS: 001_initial_schema.sql
-- Initial relational schema for profiles, courses, enrollments, and holds
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Custom Types
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('student', 'instructor', 'registrar', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE academic_status AS ENUM ('active', 'probation', 'suspended', 'graduated', 'withdrawn');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE enrollment_status AS ENUM ('enrolled', 'dropped', 'waitlisted', 'completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE hold_type AS ENUM ('library_debt', 'academic_probation', 'financial_delinquency', 'disciplinary');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. Profiles (linked 1:1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    frighton_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. STU-2026-0001, FAC-2026-0010
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'student',
    academic_status academic_status NOT NULL DEFAULT 'active',
    department VARCHAR(100),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for fast lookup by University ID (essential for Library LMS integration)
CREATE INDEX IF NOT EXISTS idx_profiles_frighton_id ON public.profiles(frighton_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- 2. Academic Terms (e.g. Fall 2026, Spring 2027)
CREATE TABLE IF NOT EXISTS public.academic_terms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL, -- e.g. 'FALL-2026'
    name VARCHAR(100) NOT NULL,       -- e.g. 'Fall Semester 2026'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Courses Catalog
CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_code VARCHAR(20) UNIQUE NOT NULL, -- e.g. 'CS101'
    title VARCHAR(200) NOT NULL,
    description TEXT,
    credits INT NOT NULL DEFAULT 3,
    department VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_courses_code ON public.courses(course_code);

-- 4. Course Sections (Offered instances in a specific term)
CREATE TABLE IF NOT EXISTS public.course_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
    term_id UUID NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
    instructor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    section_number VARCHAR(10) NOT NULL DEFAULT '01',
    schedule VARCHAR(100), -- e.g. 'MWF 10:00 - 11:30 AM'
    room VARCHAR(50),      -- e.g. 'Hall C-102'
    capacity INT NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(course_id, term_id, section_number)
);

-- 5. Enrollments
CREATE TABLE IF NOT EXISTS public.enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES public.course_sections(id) ON DELETE CASCADE,
    status enrollment_status NOT NULL DEFAULT 'enrolled',
    grade VARCHAR(5), -- e.g. 'A', 'B+', 'IP' (In Progress)
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(student_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_section ON public.enrollments(section_id);

-- 6. Student Holds (Crucial for Library Management System integration)
CREATE TABLE IF NOT EXISTS public.student_holds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    hold_type hold_type NOT NULL,
    reason TEXT NOT NULL,
    placed_by_system VARCHAR(100) NOT NULL DEFAULT 'Frighton SIS',
    placed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    resolved_at TIMESTAMPTZ -- NULL indicates hold is actively enforced
);

CREATE INDEX IF NOT EXISTS idx_student_holds_student ON public.student_holds(student_id);
CREATE INDEX IF NOT EXISTS idx_student_holds_active ON public.student_holds(student_id) WHERE resolved_at IS NULL;

-- 7. Trigger: Automatically create public.profile when a user registers in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    frighton_id_gen VARCHAR(50);
BEGIN
    frighton_id_gen := 'STU-' || to_char(CURRENT_DATE, 'YYYY') || '-' || substr(NEW.id::text, 1, 6);
    
    INSERT INTO public.profiles (
        id,
        frighton_id,
        first_name,
        last_name,
        email,
        role
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'frighton_id', frighton_id_gen),
        COALESCE(NEW.raw_user_meta_data->>'first_name', 'New'),
        COALESCE(NEW.raw_user_meta_data->>'last_name', 'Student'),
        NEW.email,
        COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'student'::user_role)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
