-- ============================================================
-- Migration: Rename frighton_id to student_number on public.profiles
-- Single source of truth for student numbers resides in profiles.
-- ============================================================

ALTER TABLE public.profiles RENAME COLUMN frighton_id TO student_number;
ALTER INDEX IF EXISTS idx_profiles_frighton_id RENAME TO idx_profiles_student_number;
ALTER TABLE public.profiles ALTER COLUMN student_number DROP NOT NULL;
