-- ============================================================
-- Frighton University SIS: 002_rls_policies.sql
-- Row Level Security (RLS) rules for student, instructor, and registrar roles
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_holds ENABLE ROW LEVEL SECURITY;

-- Helper function: Check if authenticated user is admin/registrar
CREATE OR REPLACE FUNCTION public.is_admin_or_registrar()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'registrar')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. Profiles Policies
-- Users can view their own profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- Staff can view all profiles
CREATE POLICY "Admins and registrars can view all profiles"
    ON public.profiles FOR SELECT
    USING (public.is_admin_or_registrar());

-- Instructors can view profiles of students in their sections
CREATE POLICY "Instructors can view student profiles in their sections"
    ON public.profiles FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.course_sections cs
        JOIN public.enrollments e ON e.section_id = cs.id
        WHERE cs.instructor_id = auth.uid()
        AND e.student_id = public.profiles.id
      )
    );

-- Admins and registrars can update profiles
CREATE POLICY "Admins and registrars can update profiles"
    ON public.profiles FOR UPDATE
    USING (public.is_admin_or_registrar());

-- 2. Academic Terms Policies
-- Anyone authenticated can view terms
CREATE POLICY "Authenticated users can view terms"
    ON public.academic_terms FOR SELECT
    TO authenticated
    USING (true);

-- Only admins and registrars can modify terms
CREATE POLICY "Admins and registrars can modify terms"
    ON public.academic_terms FOR ALL
    USING (public.is_admin_or_registrar());

-- 3. Courses Policies
-- Anyone authenticated can view active courses
CREATE POLICY "Authenticated users can view active courses"
    ON public.courses FOR SELECT
    TO authenticated
    USING (is_active = true OR public.is_admin_or_registrar());

-- Admins and registrars can manage courses
CREATE POLICY "Admins and registrars can manage courses"
    ON public.courses FOR ALL
    USING (public.is_admin_or_registrar());

-- 4. Course Sections Policies
-- Anyone authenticated can view course sections
CREATE POLICY "Authenticated users can view course sections"
    ON public.course_sections FOR SELECT
    TO authenticated
    USING (true);

-- Admins and registrars can manage course sections
CREATE POLICY "Admins and registrars can manage course sections"
    ON public.course_sections FOR ALL
    USING (public.is_admin_or_registrar());

-- 5. Enrollments Policies
-- Students can view their own enrollments
CREATE POLICY "Students can view own enrollments"
    ON public.enrollments FOR SELECT
    USING (auth.uid() = student_id);

-- Instructors can view enrollments in their sections
CREATE POLICY "Instructors can view section enrollments"
    ON public.enrollments FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.course_sections cs
        WHERE cs.id = public.enrollments.section_id
        AND cs.instructor_id = auth.uid()
      )
    );

-- Admins and registrars can manage all enrollments
CREATE POLICY "Admins and registrars can manage all enrollments"
    ON public.enrollments FOR ALL
    USING (public.is_admin_or_registrar());

-- 6. Student Holds Policies
-- Students can view their own holds
CREATE POLICY "Students can view own holds"
    ON public.student_holds FOR SELECT
    USING (auth.uid() = student_id);

-- Admins, registrars, and backend service role can manage holds
CREATE POLICY "Admins can view and modify holds"
    ON public.student_holds FOR ALL
    USING (public.is_admin_or_registrar());
