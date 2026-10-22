-- Regression assertions. Run ONLY inside BEGIN ... ROLLBACK (see docs/sis-page-architecture.md).
-- Creates transaction-local synthetic identities; never calls Auth/mail APIs.
DO $admin_tests$
DECLARE
  actor uuid := gen_random_uuid(); student uuid := gen_random_uuid(); student2 uuid := gen_random_uuid();
  actor_email text; email1 text; email2 text; number1 text; op uuid; event_count integer;
  payload jsonb; result jsonb; before_dashboard jsonb; after_dashboard jsonb; baseline_logs bigint;
  signed_avatar1 text := 'https://example.invalid/avatar.png?token=REVIEW_ONLY_CREATE#REVIEW_ONLY_FRAGMENT';
  signed_avatar2 text := 'https://example.invalid/avatar.png?token=REVIEW_ONLY_EDIT#REVIEW_ONLY_FRAGMENT';
BEGIN
  actor_email := 'sis-admin-test-'||actor||'@example.invalid';
  email1 := 'sis-student-test-'||student||'@example.invalid';
  email2 := 'sis-student-test-'||student2||'@example.invalid';
  number1 := 'STU-9999-'||floor(random()*1000000000000)::text;
  INSERT INTO public.users(users_id,first_name,last_name,email,password,role,is_active)
    VALUES(actor,'Test','Administrator',actor_email,'[MANAGED_BY_SUPABASE_AUTH]','Admin',true);
  before_dashboard := public.admin_dashboard(actor);
  SELECT count(*) INTO baseline_logs FROM public.admin_audit_logs;
  INSERT INTO auth.users(id,email,invited_at,created_at) VALUES(student,email1,now(),now()),(student2,email2,now(),now());
  ASSERT public.admin_student_auth(actor,email1)->>'id'=student::text,'Auth identity lookup';
  ASSERT public.admin_student_auth(actor,'absent-'||actor||'@example.invalid') IS NULL,'Missing Auth identity';
  payload := jsonb_build_object('studentNumber',number1,'firstName','Same','lastName','Name','middleName','A',
    'email',email1,'department','Test department','program','Test program','yearLevel',1,'academicStatus','probation',
    'avatarUrl',signed_avatar1);
  op := gen_random_uuid();
  result := public.admin_write_student(actor,student,op,'student.account.created',payload);
  ASSERT result->>'email'=email1,'Creation returns student snapshot';
  ASSERT result->>'avatarUrl'=signed_avatar1,'Account response preserves the signed profile URL';
  ASSERT (SELECT avatar_url=signed_avatar1 FROM public.profiles WHERE id=student),'Profile preserves the signed URL';
  ASSERT (SELECT target->>'avatarUrl'='https://example.invalid/avatar.png' AND
    changes->'avatarUrl'->>'after'='https://example.invalid/avatar.png'
    FROM public.admin_audit_logs WHERE id=op),'Creation audit strips query parameters and fragments';
  ASSERT NOT EXISTS(SELECT 1 FROM public.admin_audit_logs a WHERE id=op AND to_jsonb(a)::text LIKE '%REVIEW_ONLY_%'),
    'No creation URL secret survives anywhere in the audit event';
  ASSERT (SELECT role='Students' FROM public.users WHERE users_id=student),'Directory role fixed';
  ASSERT (SELECT role='student' FROM public.profiles WHERE id=student),'SIS role fixed';
  ASSERT (SELECT count(*) FROM public.admin_audit_logs)=baseline_logs+1,'One creation event';
  -- Repeat the operation after a lost response: no extra mutation or event.
  PERFORM public.admin_write_student(actor,student,op,'student.account.created',payload);
  ASSERT (SELECT count(*) FROM public.admin_audit_logs)=baseline_logs+1,'Replay is idempotent';
  ASSERT NOT EXISTS(SELECT 1 FROM public.admin_audit_logs a WHERE id=op AND
    (a.changes ? 'password' OR a.target ? 'password' OR a.actor ? 'password')),'Audit uses sanitized snapshots';

  -- Duplicate student numbers roll back the directory insert and audit together.
  BEGIN
    PERFORM public.admin_write_student(actor,student2,gen_random_uuid(),'student.account.created',payload||jsonb_build_object('email',email2));
    RAISE EXCEPTION 'Expected duplicate student number failure';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  ASSERT NOT EXISTS(SELECT 1 FROM public.users WHERE users_id=student2),'Failed creation left no directory record';
  ASSERT (SELECT count(*) FROM public.admin_audit_logs)=baseline_logs+1,'Failed creation left no audit record';

  -- A second student exercises filters, unique ordering, and distinct hold counts.
  PERFORM public.admin_write_student(actor,student2,gen_random_uuid(),'student.account.created',payload||
    jsonb_build_object('studentNumber',number1||'1','email',email2,'academicStatus','active'));
  INSERT INTO public.student_holds(student_id,hold_type,reason) VALUES
    (student,'disciplinary','Test hold'),(student,'disciplinary','Second test hold');
  result := public.admin_list_students(actor,jsonb_build_object('q',number1,'page',1,'pageSize',1));
  ASSERT (result->>'total')::integer=2 AND jsonb_array_length(result->'items')=1,'Search and page size';
  ASSERT result->'items'->0->>'id'=least(student,student2)::text,'UUID resolves identical-name ordering';
  result := public.admin_list_students(actor,jsonb_build_object('q',number1,'academicStatus','probation','department','test department'));
  ASSERT (result->>'total')::integer=1 AND (result->'items'->0->>'activeHoldCount')::integer=2,'Combined filters and hold count';
  result := public.admin_list_students(actor,jsonb_build_object('q',number1,'page',5,'pageSize',25));
  ASSERT result->'items'='[]'::jsonb AND (result->>'total')::integer=2,'Out-of-range page retains total';
  result := public.admin_list_students(actor,jsonb_build_object('q','no-such-student-'||actor));
  ASSERT result->'items'='[]'::jsonb AND (result->>'total')::integer=0,'Empty search';
  after_dashboard := public.admin_dashboard(actor);
  ASSERT (after_dashboard->'metrics'->>'totalStudents')::integer=(before_dashboard->'metrics'->>'totalStudents')::integer+2,'Dashboard total';
  ASSERT (after_dashboard->'metrics'->>'studentsWithActiveHolds')::integer=(before_dashboard->'metrics'->>'studentsWithActiveHolds')::integer+1,'Dashboard distinct held students';

  op := gen_random_uuid();
  PERFORM public.admin_begin_student_change(actor,student,op);
  BEGIN
    PERFORM public.admin_begin_student_change(actor,student,gen_random_uuid());
    RAISE EXCEPTION 'Expected lease conflict';
  EXCEPTION WHEN lock_not_available THEN NULL; END;
  result := public.admin_write_student(actor,student,op,'student.profile.updated',
    jsonb_build_object('firstName','Changed','program','Updated program','avatarUrl',signed_avatar2));
  ASSERT result->>'firstName'='Changed','Updated profile snapshot';
  ASSERT (SELECT first_name='Changed' FROM public.users WHERE users_id=student),'Directory synchronization';
  ASSERT (SELECT first_name='Changed' AND program='Updated program' FROM public.profiles WHERE id=student),'Profile synchronization';
  ASSERT (SELECT changes->'firstName'->>'before'='Same' AND changes->'firstName'->>'after'='Changed'
    FROM public.admin_audit_logs WHERE id=op),'Field-level before/after';
  ASSERT result->>'avatarUrl'=signed_avatar2,'Edited profile URL remains intact in the account response';
  ASSERT (SELECT target->>'avatarUrl'='https://example.invalid/avatar.png' AND
    changes->'avatarUrl'->>'before'='https://example.invalid/avatar.png' AND
    changes->'avatarUrl'->>'after'='https://example.invalid/avatar.png'
    FROM public.admin_audit_logs WHERE id=op),'Update audit sanitizes before, after, and target';
  ASSERT NOT EXISTS(SELECT 1 FROM public.admin_audit_logs a WHERE id=op AND to_jsonb(a)::text LIKE '%REVIEW_ONLY_%'),
    'No update URL secret survives anywhere in the audit event';
  op := gen_random_uuid(); PERFORM public.admin_begin_student_change(actor,student,op);
  PERFORM public.admin_write_student(actor,student,op,'student.profile.updated',
    jsonb_build_object('avatarUrl','https://example.invalid/avatar.png?token=REVIEW_ONLY_ROTATED'));
  ASSERT (SELECT changes ? 'avatarUrl' FROM public.admin_audit_logs WHERE id=op),
    'Token-only URL changes still produce an audit event';
  op := gen_random_uuid(); PERFORM public.admin_begin_student_change(actor,student,op);
  PERFORM public.admin_write_student(actor,student,op,'student.profile.updated',jsonb_build_object('avatarUrl',null));
  ASSERT (SELECT target->'avatarUrl'='null'::jsonb AND changes->'avatarUrl'->'after'='null'::jsonb
    FROM public.admin_audit_logs WHERE id=op),'Cleared avatar remains JSON null in the audit event';
  SELECT count(*) INTO event_count FROM public.admin_audit_logs;
  op := gen_random_uuid();
  PERFORM public.admin_begin_student_change(actor,student,op);
  BEGIN
    PERFORM public.admin_write_student(actor,student,op,'student.profile.updated',jsonb_build_object('studentNumber','STU-9999-0000'));
    RAISE EXCEPTION 'Expected immutable student number failure';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.admin_end_student_change(student,op);
  ASSERT (SELECT count(*) FROM public.admin_audit_logs)=event_count,'Rejected edit has no event';
  op := gen_random_uuid(); PERFORM public.admin_begin_student_change(actor,student,op);
  result := public.admin_write_student(actor,student,op,'student.profile.updated',jsonb_build_object('firstName','Changed'));
  ASSERT (SELECT count(*) FROM public.admin_audit_logs)=event_count,'Unchanged profile has no duplicate event';

  op := gen_random_uuid(); PERFORM public.admin_begin_student_change(actor,student,op);
  PERFORM public.admin_write_student(actor,student,op,'student.access.deactivated','{}');
  ASSERT (SELECT NOT is_active FROM public.users WHERE users_id=student),'Deactivated directory';
  ASSERT (SELECT academic_status='probation' FROM public.profiles WHERE id=student),'Access state independent from academic status';
  SELECT count(*) INTO event_count FROM public.admin_audit_logs;
  op := gen_random_uuid(); PERFORM public.admin_begin_student_change(actor,student,op);
  PERFORM public.admin_write_student(actor,student,op,'student.access.deactivated','{}');
  ASSERT (SELECT count(*) FROM public.admin_audit_logs)=event_count,'Already inactive has no duplicate event';
  result := public.admin_list_students(actor,jsonb_build_object('q',number1,'accessStatus','inactive'));
  ASSERT (result->>'total')::integer=1,'Inactive filter';
  op := gen_random_uuid(); PERFORM public.admin_begin_student_change(actor,student,op);
  PERFORM public.admin_write_student(actor,student,op,'student.access.reactivated','{}');
  ASSERT (SELECT is_active FROM public.users WHERE users_id=student),'Reactivated directory';
  op := gen_random_uuid(); PERFORM public.admin_begin_student_change(actor,student,op);
  PERFORM public.admin_write_student(actor,student,op,'student.password_recovery.requested','{}');
  ASSERT (SELECT changes='{}'::jsonb FROM public.admin_audit_logs WHERE id=op),'Recovery event excludes secrets';

  BEGIN
    PERFORM public.admin_get_student(student,student2);
    RAISE EXCEPTION 'Expected student actor rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.admin_get_student(actor,actor);
    RAISE EXCEPTION 'Expected non-student target rejection';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    UPDATE public.admin_audit_logs SET changes='{}' WHERE id=op;
    RAISE EXCEPTION 'Expected audit update rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.admin_audit_logs WHERE id=op;
    RAISE EXCEPTION 'Expected audit deletion rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'admin_%' AND
      (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))),
    'Only service role can execute admin RPCs';
  ASSERT NOT has_table_privilege('authenticated','public.admin_audit_logs','INSERT,UPDATE,DELETE,TRUNCATE'),'Browser cannot modify audit';
  ASSERT NOT has_table_privilege('service_role','public.admin_audit_logs','UPDATE,DELETE,TRUNCATE'),'Service role cannot alter audit history';
  PERFORM set_config('sis.test_actor_email',actor_email,true);
  PERFORM set_config('sis.test_student_email',email1,true);
  PERFORM set_config('sis.test_actor_id',actor::text,true);
  PERFORM set_config('sis.test_student_id',student::text,true);
END;
$admin_tests$;

-- The insertion boundary also protects producers that do not use the RPC.
SET LOCAL ROLE service_role;
DO $direct_insert$
DECLARE event_id uuid := gen_random_uuid(); event_row public.admin_audit_logs%ROWTYPE;
BEGIN
  INSERT INTO public.admin_audit_logs(id,actor_id,actor,action,student_id,target,changes)
    VALUES(event_id,current_setting('sis.test_actor_id')::uuid,'{}','student.profile.updated',
      current_setting('sis.test_student_id')::uuid,
      jsonb_build_object('avatarUrl','HTTPS://user:REVIEW_ONLY_PASSWORD@example.invalid/avatar.png?token=REVIEW_ONLY_DIRECT#fragment'),
      jsonb_build_object('avatarUrl',jsonb_build_object(
        'before','https://example.invalid/old.png?signature=REVIEW_ONLY_BEFORE',
        'after','https://example.invalid/new.png#REVIEW_ONLY_AFTER')))
    RETURNING * INTO event_row;
  ASSERT event_row.target->>'avatarUrl'='HTTPS://example.invalid/avatar.png','Legacy URL credentials are stripped';
  ASSERT event_row.changes->'avatarUrl'->>'before'='https://example.invalid/old.png' AND
    event_row.changes->'avatarUrl'->>'after'='https://example.invalid/new.png','Direct insert sanitizes change snapshots';
  ASSERT to_jsonb(event_row)::text NOT LIKE '%REVIEW_ONLY_%','Direct insert stores no URL secret';
END;
$direct_insert$;
RESET ROLE;

-- Exercise RLS as actual browser roles, including inactive directory admins.
SELECT set_config('request.jwt.claims',jsonb_build_object('email',current_setting('sis.test_actor_email'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $rls_admin$ BEGIN ASSERT (SELECT count(*) FROM public.admin_audit_logs)>0,'Active admin can read audit'; END; $rls_admin$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('email',current_setting('sis.test_student_email'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $rls_student$ BEGIN ASSERT (SELECT count(*) FROM public.admin_audit_logs)=0,'Students cannot read audit'; END; $rls_student$;
RESET ROLE;
UPDATE public.users SET is_active=false WHERE users_id=current_setting('sis.test_actor_id')::uuid;
SELECT set_config('request.jwt.claims',jsonb_build_object('email',current_setting('sis.test_actor_email'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $rls_inactive$ BEGIN ASSERT (SELECT count(*) FROM public.admin_audit_logs)=0,'Inactive admins cannot read audit'; END; $rls_inactive$;
RESET ROLE;
SELECT 'Admin SQL regression assertions passed; transaction must be rolled back.' AS result;
