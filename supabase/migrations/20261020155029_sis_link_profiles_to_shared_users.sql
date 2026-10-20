-- Align the SIS academic profile key with the existing shared LMS/SIS user ID.
-- The SIS tables are empty when this migration is introduced.

ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES public.users(users_id) ON DELETE CASCADE;

-- The shared public.users table is the account directory; Auth validates the
-- credentials separately. Use the trusted Auth email claim to map a request
-- to its shared account ID, without using user-editable metadata for access.
CREATE OR REPLACE FUNCTION private.current_sis_user_id()
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

CREATE OR REPLACE FUNCTION private.is_sis_admin()
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

REVOKE ALL ON FUNCTION private.current_sis_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_sis_user_id() TO authenticated;

DROP POLICY "Students view their own profile" ON public.profiles;
CREATE POLICY "Students view their own profile" ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT private.current_sis_user_id()) = id);

DROP POLICY "Users view their academic records" ON public.academic_records;
CREATE POLICY "Users view their academic records" ON public.academic_records FOR SELECT TO authenticated
  USING ((SELECT private.current_sis_user_id()) = student_id OR (SELECT private.is_sis_admin()));

DROP POLICY "Users view their holds" ON public.student_holds;
CREATE POLICY "Users view their holds" ON public.student_holds FOR SELECT TO authenticated
  USING ((SELECT private.current_sis_user_id()) = student_id OR (SELECT private.is_sis_admin()));

DROP POLICY "Users view their accounts" ON public.student_accounts;
CREATE POLICY "Users view their accounts" ON public.student_accounts FOR SELECT TO authenticated
  USING ((SELECT private.current_sis_user_id()) = student_id OR (SELECT private.is_sis_admin()));

DROP POLICY "Users view their payments" ON public.student_payments;
CREATE POLICY "Users view their payments" ON public.student_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.student_accounts account
    WHERE account.id = student_payments.account_id
      AND (account.student_id = (SELECT private.current_sis_user_id()) OR (SELECT private.is_sis_admin()))
  ));
