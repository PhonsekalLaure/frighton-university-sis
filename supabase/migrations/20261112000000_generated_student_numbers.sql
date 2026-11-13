BEGIN;

-- Preserve the highest committed number, including after a student is deleted.
-- Row locking on the yearly counter serializes simultaneous allocations.
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE private.sis_student_number_counters (
  year text PRIMARY KEY CHECK (year ~ '^[0-9]{4}$'),
  last_value numeric NOT NULL CHECK (last_value >= 0 AND last_value = trunc(last_value))
);
ALTER TABLE private.sis_student_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.sis_student_number_counters FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO private.sis_student_number_counters(year,last_value)
SELECT split_part(student_number,'-',2),max(split_part(student_number,'-',3)::numeric)
FROM public.profiles WHERE student_number ~ '^STU-[0-9]{4}-[0-9]{4,}$'
GROUP BY split_part(student_number,'-',2);

CREATE FUNCTION private.assign_sis_student_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE number_year text; next_value numeric; digits text;
BEGIN
  IF NEW.role::text <> 'student' THEN RETURN NEW; END IF;
  IF NEW.student_number IS NULL THEN
    number_year := to_char(clock_timestamp() AT TIME ZONE 'Asia/Manila','YYYY');
    INSERT INTO private.sis_student_number_counters AS counter(year,last_value)
      VALUES(number_year,1)
    ON CONFLICT (year) DO UPDATE SET last_value=counter.last_value+1
    RETURNING last_value INTO next_value;
    digits := next_value::text;
    NEW.student_number := 'STU-'||number_year||'-'||repeat('0',greatest(0,4-length(digits)))||digits;
  ELSIF NEW.student_number ~ '^STU-[0-9]{4}-[0-9]{4,}$' THEN
    -- Seed/import writes advance the same counter without changing existing IDs.
    INSERT INTO private.sis_student_number_counters AS counter(year,last_value)
      VALUES(split_part(NEW.student_number,'-',2),split_part(NEW.student_number,'-',3)::numeric)
    ON CONFLICT (year) DO UPDATE SET last_value=greatest(counter.last_value,excluded.last_value);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.assign_sis_student_number() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER assign_sis_student_number BEFORE INSERT OR UPDATE OF student_number ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.assign_sis_student_number();

CREATE OR REPLACE FUNCTION public.admin_write_student(p_actor_id uuid,p_student_id uuid,p_operation_id uuid,
  p_action text,p_values jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor_data jsonb; before_data jsonb; after_data jsonb; delta jsonb; auth_email text;
  existing_event public.admin_audit_logs%ROWTYPE;
BEGIN
  actor_data := private.admin_actor(p_actor_id);
  SELECT * INTO existing_event FROM public.admin_audit_logs WHERE id=p_operation_id;
  IF FOUND THEN
    IF existing_event.actor_id<>p_actor_id OR existing_event.student_id<>p_student_id OR existing_event.action<>p_action THEN
      RAISE EXCEPTION 'Operation conflicts with an existing request.' USING ERRCODE='23505'; END IF;
    RETURN existing_event.target;
  END IF;
  IF p_action NOT IN ('student.account.created','student.profile.updated','student.access.deactivated',
    'student.access.reactivated','student.password_recovery.requested','student.invitation.resent') THEN
    RAISE EXCEPTION 'Invalid account action.' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('firstName','middleName','lastName','email',
      'department','program','yearLevel','academicStatus','avatarUrl','studentNumber')) THEN
    RAISE EXCEPTION 'Unknown student field.' USING ERRCODE='22023'; END IF;
  IF p_action<>'student.account.created' THEN
    PERFORM 1 FROM private.admin_student_locks WHERE student_id=p_student_id AND operation_id=p_operation_id
      AND expires_at>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account change lease expired. Retry.' USING ERRCODE='55P03'; END IF;
    PERFORM 1 FROM public.users WHERE users_id=p_student_id FOR UPDATE;
    PERFORM 1 FROM public.profiles WHERE id=p_student_id FOR UPDATE;
    before_data := public.admin_get_student(p_actor_id,p_student_id);
  END IF;
  IF p_action='student.account.created' THEN
    -- Older deployed servers may still supply a number during rollout. The new
    -- HTTP contract omits it; seed/import callers retain their existing IDs.
    IF p_values ? 'studentNumber' AND (p_values->>'studentNumber' IS NULL OR
      p_values->>'studentNumber' !~ '^STU-[0-9]{4}-[0-9]{4,}$') THEN
      RAISE EXCEPTION 'Invalid student number.' USING ERRCODE='22023'; END IF;
    SELECT email INTO auth_email FROM auth.users WHERE id=p_student_id AND invited_at IS NOT NULL;
    IF auth_email IS NULL OR lower(auth_email)<>lower(p_values->>'email') THEN
      RAISE EXCEPTION 'Invited Auth identity not found.' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.users WHERE lower(email)=lower(p_values->>'email')) OR
       EXISTS(SELECT 1 FROM public.profiles WHERE lower(email)=lower(p_values->>'email') OR student_number=p_values->>'studentNumber') THEN
      RAISE EXCEPTION 'Email or student number already exists.' USING ERRCODE='23505'; END IF;
    INSERT INTO public.users(users_id,first_name,middle_name,last_name,email,password,role,is_active)
      VALUES(p_student_id,p_values->>'firstName',p_values->>'middleName',p_values->>'lastName',
        p_values->>'email','[MANAGED_BY_SUPABASE_AUTH]','Students',true);
    INSERT INTO public.profiles(id,student_number,first_name,last_name,email,role,department,program,year_level,academic_status,avatar_url)
      VALUES(p_student_id,p_values->>'studentNumber',p_values->>'firstName',p_values->>'lastName',p_values->>'email',
        'student',p_values->>'department',p_values->>'program',(p_values->>'yearLevel')::smallint,
        (p_values->>'academicStatus')::public.academic_status,p_values->>'avatarUrl');
  ELSIF p_action='student.profile.updated' THEN
    IF p_values ? 'studentNumber' THEN RAISE EXCEPTION 'Student number is immutable.' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_each(p_values) e WHERE before_data->e.key IS DISTINCT FROM e.value) THEN
      DELETE FROM private.admin_student_locks WHERE student_id=p_student_id AND operation_id=p_operation_id;
      RETURN before_data;
    END IF;
    IF p_values ? 'email' THEN
      IF EXISTS(SELECT 1 FROM public.users WHERE lower(email)=lower(p_values->>'email') AND users_id<>p_student_id) OR
         EXISTS(SELECT 1 FROM public.profiles WHERE lower(email)=lower(p_values->>'email') AND id<>p_student_id) THEN
        RAISE EXCEPTION 'Email already exists.' USING ERRCODE='23505'; END IF;
    END IF;
    UPDATE public.users SET first_name=CASE WHEN p_values?'firstName' THEN p_values->>'firstName' ELSE first_name END,
      middle_name=CASE WHEN p_values?'middleName' THEN p_values->>'middleName' ELSE middle_name END,
      last_name=CASE WHEN p_values?'lastName' THEN p_values->>'lastName' ELSE last_name END,
      email=CASE WHEN p_values?'email' THEN p_values->>'email' ELSE email END,updated_at=clock_timestamp() WHERE users_id=p_student_id;
    UPDATE public.profiles SET first_name=CASE WHEN p_values?'firstName' THEN p_values->>'firstName' ELSE first_name END,
      last_name=CASE WHEN p_values?'lastName' THEN p_values->>'lastName' ELSE last_name END,
      email=CASE WHEN p_values?'email' THEN p_values->>'email' ELSE email END,
      department=CASE WHEN p_values?'department' THEN p_values->>'department' ELSE department END,
      program=CASE WHEN p_values?'program' THEN p_values->>'program' ELSE program END,
      year_level=CASE WHEN p_values?'yearLevel' THEN (p_values->>'yearLevel')::smallint ELSE year_level END,
      academic_status=CASE WHEN p_values?'academicStatus' THEN (p_values->>'academicStatus')::public.academic_status ELSE academic_status END,
      avatar_url=CASE WHEN p_values?'avatarUrl' THEN p_values->>'avatarUrl' ELSE avatar_url END,
      updated_at=clock_timestamp() WHERE id=p_student_id;
  ELSIF p_action IN ('student.access.deactivated','student.access.reactivated') THEN
    UPDATE public.users SET is_active=(p_action='student.access.reactivated'),updated_at=clock_timestamp()
      WHERE users_id=p_student_id AND is_active IS DISTINCT FROM (p_action='student.access.reactivated');
  END IF;
  after_data := private.admin_student(p_student_id);
  delta := private.admin_changes(before_data,after_data);
  IF delta<>'{}'::jsonb OR p_action IN ('student.password_recovery.requested','student.invitation.resent') THEN
    INSERT INTO public.admin_audit_logs(id,actor_id,actor,action,student_id,target,changes)
      VALUES(p_operation_id,p_actor_id,actor_data,p_action,p_student_id,after_data,delta);
  END IF;
  DELETE FROM private.admin_student_locks WHERE student_id=p_student_id AND operation_id=p_operation_id;
  RETURN after_data;
END;
$$;

COMMIT;

