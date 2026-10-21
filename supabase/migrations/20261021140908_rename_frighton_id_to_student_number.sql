-- ============================================================
-- Migration: Rename frighton_id to student_number on public.profiles
-- Single source of truth for student numbers resides in profiles.
-- ============================================================

-- This database was renamed before migration history was reconciled. Make the
-- migration safe for both the original schema and the already-renamed live
-- schema, so it can be recorded without rewriting data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'frighton_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'student_number'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN frighton_id TO student_number;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_profiles_frighton_id') IS NOT NULL
    AND to_regclass('public.idx_profiles_student_number') IS NULL THEN
    ALTER INDEX public.idx_profiles_frighton_id RENAME TO idx_profiles_student_number;
  END IF;
END $$;

ALTER TABLE public.profiles ALTER COLUMN student_number DROP NOT NULL;
