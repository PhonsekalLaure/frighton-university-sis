-- Additive account lifecycle support. Shared LMS Auth settings are not changed here.
BEGIN;

ALTER TABLE public.admin_audit_logs DROP CONSTRAINT admin_audit_logs_action_check;
ALTER TABLE public.admin_audit_logs ADD CONSTRAINT admin_audit_logs_action_check CHECK (action IN (
  'student.account.created','student.profile.updated','student.access.deactivated',
  'student.access.reactivated','student.password_recovery.requested','student.invitation.resent'));

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
  IF delta<>'{}'::jsonb OR p_action IN ('student.password_recovery.requested','student.invitation.resent') THEN
    INSERT INTO public.admin_audit_logs(id,actor_id,actor,action,student_id,target,changes)
      VALUES(p_operation_id,p_actor_id,actor_data,p_action,p_student_id,after_data,delta);
  END IF;
  DELETE FROM private.admin_student_locks WHERE student_id=p_student_id AND operation_id=p_operation_id;
  RETURN after_data;
END;
$$;


CREATE TABLE private.sis_account_request_limits (
  bucket text NOT NULL CHECK (bucket IN ('mail_actor','mail_minute','mail_hour','password_ip')),
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket,key_hash)
);
CREATE INDEX sis_account_request_limits_expiry ON private.sis_account_request_limits(expires_at);
ALTER TABLE private.sis_account_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.sis_account_request_limits FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sis_reserve_account_request(p_scope text,p_key text,p_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rules jsonb; rule jsonb; current_count integer; expiry timestamptz; retry_after integer := 0;
  checked_at timestamptz := clock_timestamp();
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Expected a hashed key.' USING ERRCODE='22023'; END IF;
  IF p_scope='admin_mail' THEN
    PERFORM private.admin_actor(p_actor_id);
    rules := jsonb_build_array(
      jsonb_build_object('bucket','mail_actor','key',encode(sha256(convert_to(p_actor_id::text,'UTF8')),'hex'),'limit',20,'seconds',900),
      jsonb_build_object('bucket','mail_minute','key',p_key,'limit',1,'seconds',60),
      jsonb_build_object('bucket','mail_hour','key',p_key,'limit',5,'seconds',3600));
  ELSIF p_scope='password_complete' AND p_actor_id IS NULL THEN
    rules := jsonb_build_array(jsonb_build_object('bucket','password_ip','key',p_key,'limit',20,'seconds',900));
  ELSE RAISE EXCEPTION 'Invalid request scope.' USING ERRCODE='22023'; END IF;
  -- One short transaction lock also keeps bounded expiry cleanup from deadlocking
  -- with reservations for other actors/recipients. No network calls hold this lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('sis-account-limits',0));
  checked_at := clock_timestamp();
  DELETE FROM private.sis_account_request_limits WHERE (bucket,key_hash) IN (
    SELECT bucket,key_hash FROM private.sis_account_request_limits WHERE expires_at<=checked_at
      ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
  FOR rule IN SELECT value FROM jsonb_array_elements(rules) LOOP
    SELECT attempts,expires_at INTO current_count,expiry FROM private.sis_account_request_limits
      WHERE bucket=rule->>'bucket' AND key_hash=rule->>'key';
    IF expiry>checked_at AND current_count>=(rule->>'limit')::integer THEN
      retry_after := greatest(retry_after,ceil(extract(epoch FROM expiry-checked_at))::integer);
    END IF;
  END LOOP;
  IF retry_after>0 THEN RETURN jsonb_build_object('allowed',false,'retryAfter',retry_after); END IF;
  FOR rule IN SELECT value FROM jsonb_array_elements(rules) LOOP
    INSERT INTO private.sis_account_request_limits(bucket,key_hash,attempts,expires_at)
      VALUES(rule->>'bucket',rule->>'key',1,checked_at+make_interval(secs=>(rule->>'seconds')::integer))
    ON CONFLICT (bucket,key_hash) DO UPDATE SET
      attempts=CASE WHEN sis_account_request_limits.expires_at<=checked_at THEN 1 ELSE sis_account_request_limits.attempts+1 END,
      expires_at=CASE WHEN sis_account_request_limits.expires_at<=checked_at THEN excluded.expires_at ELSE sis_account_request_limits.expires_at END;
  END LOOP;
  RETURN jsonb_build_object('allowed',true,'retryAfter',0);
END;
$$;

CREATE FUNCTION private.sis_mask_email(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_email IS NULL THEN NULL ELSE left(p_email,1)||'***@'||split_part(p_email,'@',2) END;
$$;

CREATE FUNCTION public.sis_account_diagnostics(p_student_id uuid DEFAULT NULL,p_operation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE sid uuid := p_student_id; auth_id uuid; d record; p record; identities jsonb; events jsonb; lease jsonb;
BEGIN
  IF (p_student_id IS NULL)=(p_operation_id IS NULL) THEN
    RAISE EXCEPTION 'Provide exactly one student or operation UUID.' USING ERRCODE='22023'; END IF;
  IF p_operation_id IS NOT NULL THEN
    SELECT student_id INTO sid FROM public.admin_audit_logs WHERE id=p_operation_id;
    SELECT id INTO auth_id FROM auth.users
      WHERE raw_user_meta_data->>'sis_provisioning_operation_id'=p_operation_id::text LIMIT 1;
    IF sid IS NULL THEN
      SELECT u.users_id INTO sid FROM public.users u JOIN auth.users a ON lower(a.email)=lower(u.email) WHERE a.id=auth_id;
    END IF;
  END IF;
  SELECT users_id,email,role,is_active INTO d FROM public.users WHERE users_id=sid;
  SELECT id,email,role INTO p FROM public.profiles WHERE id=sid;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'email',private.sis_mask_email(a.email),
    'invitedAt',a.invited_at,'emailConfirmedAt',a.email_confirmed_at,'lastSignInAt',a.last_sign_in_at,
    'hasPassword',coalesce(a.encrypted_password<>'',false),
    'emailMatchesDirectory',lower(a.email)=lower(d.email),'emailMatchesProfile',lower(a.email)=lower(p.email))
    ORDER BY a.id),'[]'::jsonb) INTO identities FROM auth.users a
    WHERE a.id=auth_id OR a.id=sid OR lower(a.email)=lower(d.email) OR lower(a.email)=lower(p.email);
  SELECT jsonb_build_object('operationId',operation_id,'expiresAt',expires_at,'active',expires_at>now())
    INTO lease FROM private.admin_student_locks WHERE student_id=sid;
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC,e.id DESC),'[]'::jsonb) INTO events FROM (
    SELECT id,actor_id,student_id,action,created_at FROM public.admin_audit_logs
    WHERE (p_operation_id IS NOT NULL AND id=p_operation_id) OR (p_operation_id IS NULL AND student_id=sid)
    ORDER BY created_at DESC,id DESC LIMIT 10) e;
  RETURN jsonb_build_object('studentId',sid,'operationId',p_operation_id,
    'directory',CASE WHEN d.users_id IS NULL THEN NULL ELSE jsonb_build_object('id',d.users_id,
      'email',private.sis_mask_email(d.email),'role',d.role,'isActive',d.is_active) END,
    'profile',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'email',private.sis_mask_email(p.email),'role',p.role) END,
    'directoryProfileEmailsMatch',lower(d.email)=lower(p.email),
    'authCandidates',identities,'lease',lease,'auditEvidence',events);
END;
$$;

REVOKE ALL ON FUNCTION private.sis_mask_email(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.sis_reserve_account_request(text,text,uuid),
  public.sis_account_diagnostics(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sis_reserve_account_request(text,text,uuid),
  public.sis_account_diagnostics(uuid,uuid) TO service_role;
COMMIT;
