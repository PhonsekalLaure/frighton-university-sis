-- Administrators belong to the shared SIS/LMS directory, not student profiles.
BEGIN;

-- Keep the dependency check and deletion together, including concurrent writes.
LOCK TABLE public.users IN SHARE MODE;
LOCK TABLE public.profiles, public.academic_records, public.student_accounts,
  public.student_holds IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION private.is_sis_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.users_id = (SELECT private.current_sis_user_id())
      AND lower(u.role) = 'admin' AND u.is_active
  );
$$;
REVOKE ALL ON FUNCTION private.is_sis_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_sis_admin() TO authenticated;

DO $cleanup$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles p LEFT JOIN public.users u ON u.users_id = p.id
    WHERE p.role = 'admin' AND (
      u.users_id IS NULL OR lower(u.role) <> 'admin'
      OR EXISTS (SELECT 1 FROM public.academic_records r WHERE r.student_id = p.id)
      OR EXISTS (SELECT 1 FROM public.student_accounts a WHERE a.student_id = p.id)
      OR EXISTS (SELECT 1 FROM public.student_holds h WHERE h.student_id = p.id)
    )
  ) THEN
    RAISE EXCEPTION 'Admin profiles have conflicting directory roles or student records; review before cleanup.';
  END IF;
  DELETE FROM public.profiles WHERE role = 'admin';
END;
$cleanup$;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_student_role_only CHECK (role = 'student');
COMMENT ON TABLE public.profiles IS
  'SIS student academic profiles. Administrator identity and access are stored in public.users.';

COMMIT;
