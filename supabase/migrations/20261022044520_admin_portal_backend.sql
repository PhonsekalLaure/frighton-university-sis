-- Admin account management. All writes enter through service-role RPCs.
-- Shared LMS policies and academic/billing/library data are intentionally untouched.
BEGIN;

CREATE TABLE public.admin_audit_logs (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  actor jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('student.account.created', 'student.profile.updated',
    'student.access.deactivated', 'student.access.reactivated', 'student.password_recovery.requested')),
  student_id uuid NOT NULL,
  target jsonb NOT NULL,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Snapshots survive future directory changes; deliberately no cascading FKs.
CREATE INDEX admin_audit_logs_recent ON public.admin_audit_logs (created_at DESC, id DESC);
CREATE INDEX admin_audit_logs_student ON public.admin_audit_logs (student_id, created_at DESC, id DESC);
CREATE INDEX admin_audit_logs_actor ON public.admin_audit_logs (actor_id, created_at DESC, id DESC);
CREATE INDEX admin_audit_logs_action ON public.admin_audit_logs (action, created_at DESC, id DESC);
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admin_audit_logs TO authenticated;
GRANT SELECT, INSERT ON public.admin_audit_logs TO service_role;
CREATE FUNCTION private.can_read_admin_audit() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u WHERE u.users_id = (SELECT private.current_sis_user_id())
      AND lower(u.role) = 'admin' AND u.is_active
  );
$$;
REVOKE ALL ON FUNCTION private.can_read_admin_audit() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.can_read_admin_audit() TO authenticated;
CREATE POLICY "Active directory admins read SIS audit logs" ON public.admin_audit_logs
  FOR SELECT TO authenticated USING ((SELECT private.can_read_admin_audit()));

CREATE FUNCTION private.reject_admin_audit_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Audit records are append-only.' USING ERRCODE = '42501'; END;
$$;
CREATE TRIGGER admin_audit_logs_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.admin_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION private.reject_admin_audit_change();

-- Distributed lease covers the external Auth call as well as the SQL commit.
CREATE TABLE private.admin_student_locks (
  student_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON private.admin_student_locks FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.admin_actor(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object('id', users_id, 'fullName', concat_ws(' ', first_name, middle_name, last_name),
    'email', email) INTO result FROM public.users WHERE users_id = p_id AND lower(role) = 'admin' AND is_active;
  IF result IS NULL THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION private.admin_student(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', u.users_id, 'studentNumber', p.student_number,
    'firstName', u.first_name, 'middleName', u.middle_name, 'lastName', u.last_name,
    'fullName', concat_ws(' ', u.first_name, u.middle_name, u.last_name), 'email', u.email,
    'department', p.department, 'program', p.program, 'yearLevel', p.year_level,
    'academicStatus', p.academic_status, 'avatarUrl', p.avatar_url, 'isActive', u.is_active,
    'createdAt', p.created_at, 'updatedAt', greatest(p.updated_at, u.updated_at))
  FROM public.users u JOIN public.profiles p ON p.id = u.users_id
  WHERE u.users_id = p_id AND lower(u.role) IN ('student', 'students') AND p.role = 'student';
$$;

CREATE FUNCTION private.admin_changes(p_before jsonb, p_after jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('before', p_before->k, 'after', p_after->k)), '{}'::jsonb)
  FROM unnest(ARRAY['studentNumber','firstName','middleName','lastName','email','department','program',
    'yearLevel','academicStatus','avatarUrl','isActive']) k
  WHERE p_before->k IS DISTINCT FROM p_after->k;
$$;

-- Minimal Auth lookup by email: directory UUIDs need not be Auth UUIDs.
CREATE FUNCTION public.admin_student_auth(p_actor_id uuid, p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM private.admin_actor(p_actor_id);
  SELECT jsonb_build_object('id', id, 'invitedAt', invited_at,
    'emailConfirmedAt', email_confirmed_at, 'lastSignInAt', last_sign_in_at)
  INTO result FROM auth.users WHERE lower(email) = lower(p_email);
  RETURN result;
END;
$$;

CREATE FUNCTION public.admin_get_student(p_actor_id uuid, p_student_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM private.admin_actor(p_actor_id);
  result := private.admin_student(p_student_id);
  IF result IS NULL THEN RAISE EXCEPTION 'Student not found.' USING ERRCODE = 'P0002'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.admin_list_students(p_actor_id uuid, p_filters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; page_no integer := coalesce((p_filters->>'page')::integer,1);
  page_size integer := coalesce((p_filters->>'pageSize')::integer,25);
BEGIN
  PERFORM private.admin_actor(p_actor_id);
  IF page_no < 1 OR page_no > 1000000 OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid pagination.' USING ERRCODE = '22023'; END IF;
  WITH students AS (
    SELECT u.users_id, u.last_name, u.first_name, private.admin_student(u.users_id) AS student,
      (SELECT count(*) FROM public.student_holds h WHERE h.student_id=u.users_id AND h.resolved_at IS NULL) AS holds
    FROM public.users u JOIN public.profiles p ON p.id=u.users_id
    WHERE lower(u.role) IN ('student','students') AND p.role='student'
      AND (p_filters->>'accessStatus' IS NULL OR u.is_active=(p_filters->>'accessStatus'='active'))
      AND (p_filters->>'academicStatus' IS NULL OR p.academic_status::text=p_filters->>'academicStatus')
      AND (p_filters->>'department' IS NULL OR lower(p.department)=lower(p_filters->>'department'))
      AND (p_filters->>'q' IS NULL OR strpos(lower(concat_ws(' ',u.first_name,u.middle_name,u.last_name,
        u.email,p.student_number)),lower(p_filters->>'q'))>0)
  ), paged AS (
    SELECT *, row_number() OVER (ORDER BY lower(last_name),lower(first_name),users_id) AS position
    FROM students ORDER BY lower(last_name),lower(first_name),users_id
    LIMIT page_size OFFSET (page_no-1)*page_size
  ) SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(student || jsonb_build_object('activeHoldCount',holds)
    ORDER BY position) FROM paged),'[]'::jsonb),'page',page_no,'pageSize',page_size,
    'total',(SELECT count(*) FROM students),'totalPages',ceil((SELECT count(*) FROM students)::numeric/page_size)) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.admin_dashboard(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM private.admin_actor(p_actor_id);
  IF (SELECT count(*) FROM public.academic_terms WHERE is_active)>1 THEN
    RAISE EXCEPTION 'Multiple active academic terms.' USING ERRCODE = 'P0001'; END IF;
  WITH students AS (
    SELECT u.users_id,u.is_active,p.academic_status FROM public.users u JOIN public.profiles p ON p.id=u.users_id
    WHERE lower(u.role) IN ('student','students') AND p.role='student'
  ) SELECT jsonb_build_object('metrics',jsonb_build_object('totalStudents',count(*),
    'activeStudents',count(*) FILTER (WHERE is_active),'inactiveStudents',count(*) FILTER (WHERE NOT is_active),
    'probationStudents',count(*) FILTER (WHERE academic_status='probation'),
    'studentsWithActiveHolds',count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.student_holds h WHERE h.student_id=students.users_id AND h.resolved_at IS NULL))),
    'currentTerm',(SELECT jsonb_build_object('id',id,'code',code,'name',name,'startDate',start_date,'endDate',end_date)
      FROM public.academic_terms WHERE is_active),
    'recentActivity',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC,a.id DESC)
      FROM (SELECT * FROM public.admin_audit_logs ORDER BY created_at DESC,id DESC LIMIT 10) a),'[]'::jsonb))
    INTO result FROM students;
  RETURN result;
END;
$$;

CREATE FUNCTION public.admin_begin_student_change(p_actor_id uuid,p_student_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  result := public.admin_get_student(p_actor_id,p_student_id);
  INSERT INTO private.admin_student_locks VALUES(p_student_id,p_operation_id,now()+interval '5 minutes')
    ON CONFLICT (student_id) DO UPDATE SET operation_id=excluded.operation_id,expires_at=excluded.expires_at
    WHERE private.admin_student_locks.expires_at<now() OR private.admin_student_locks.operation_id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Another account change is in progress. Retry shortly.' USING ERRCODE='55P03'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.admin_end_student_change(p_student_id uuid,p_operation_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM private.admin_student_locks WHERE student_id=p_student_id AND operation_id=p_operation_id;
$$;

-- The audit ID doubles as a request operation ID, making RPC retries safe.
CREATE FUNCTION public.admin_write_student(p_actor_id uuid,p_student_id uuid,p_operation_id uuid,
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
    'student.access.reactivated','student.password_recovery.requested') THEN
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
    IF p_values->>'studentNumber' IS NULL OR p_values->>'studentNumber' !~ '^STU-[0-9]{4}-[0-9]{4,}$' THEN
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
  IF delta<>'{}'::jsonb OR p_action='student.password_recovery.requested' THEN
    INSERT INTO public.admin_audit_logs(id,actor_id,actor,action,student_id,target,changes)
      VALUES(p_operation_id,p_actor_id,actor_data,p_action,p_student_id,after_data,delta);
  END IF;
  DELETE FROM private.admin_student_locks WHERE student_id=p_student_id AND operation_id=p_operation_id;
  RETURN after_data;
END;
$$;

-- Explicit grants, including removal of PostgreSQL's default PUBLIC EXECUTE.
REVOKE ALL ON FUNCTION private.reject_admin_audit_change(),private.admin_actor(uuid),private.admin_student(uuid),
  private.admin_changes(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_student_auth(uuid,text),public.admin_get_student(uuid,uuid),
  public.admin_list_students(uuid,jsonb),public.admin_dashboard(uuid),public.admin_begin_student_change(uuid,uuid,uuid),
  public.admin_end_student_change(uuid,uuid),public.admin_write_student(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_student_auth(uuid,text),public.admin_get_student(uuid,uuid),
  public.admin_list_students(uuid,jsonb),public.admin_dashboard(uuid),public.admin_begin_student_change(uuid,uuid,uuid),
  public.admin_end_student_change(uuid,uuid),public.admin_write_student(uuid,uuid,uuid,text,jsonb) TO service_role;

COMMIT;
