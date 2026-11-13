-- Synthetic records only. Caller must wrap this file in BEGIN ... ROLLBACK.
DO $tests$
DECLARE actor uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); failed_sid uuid:=gen_random_uuid();
  op uuid:=gen_random_uuid(); retry_op uuid:=gen_random_uuid(); failed_op uuid:=gen_random_uuid(); claim uuid:=gen_random_uuid();
  email1 text; email2 text; values1 jsonb; result jsonb; assigned_number text; number_before numeric;
BEGIN
  email1:='sis-invite-test-'||sid||'@example.invalid'; email2:='sis-invite-test-'||failed_sid||'@example.invalid';
  INSERT INTO public.users(users_id,first_name,last_name,email,password,role,is_active)
    VALUES(actor,'Test','Admin','sis-invite-admin-'||actor||'@example.invalid','x','Admin',true);
  INSERT INTO auth.users(id,email,invited_at,created_at,raw_user_meta_data) VALUES
    (sid,email1,now(),now(),jsonb_build_object('sis_provisioning_operation_id',op)),
    (failed_sid,email2,now(),now(),jsonb_build_object('sis_provisioning_operation_id',failed_op));
  values1:=jsonb_build_object('firstName','Test','lastName','Student','email',email1,'department','Humanities',
    'program','Test program','yearLevel',1,'academicStatus','active');
  ASSERT public.admin_invitation_ready(actor),'Migration readiness is checked before Auth provisioning';
  ASSERT public.sis_invitation_delivery_ready(),'Sender readiness does not mutate data';
  result:=public.admin_queue_student_invitation(actor,sid,op,'student.account.created',values1,sid);
  assigned_number:=result->>'studentNumber';
  ASSERT assigned_number IS NOT NULL,'Number assigned';
  ASSERT EXISTS(SELECT 1 FROM public.users WHERE users_id=sid),'Directory committed';
  ASSERT EXISTS(SELECT 1 FROM public.profiles WHERE id=sid),'Profile committed';
  ASSERT EXISTS(SELECT 1 FROM public.admin_audit_logs WHERE id=op),'Audit committed';
  ASSERT EXISTS(SELECT 1 FROM private.sis_invitation_deliveries WHERE student_id=sid AND status='queued'),'Pending invitation request committed';
  ASSERT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='private'
    AND table_name='sis_invitation_deliveries' AND (column_name LIKE '%token%' OR column_name LIKE '%payload%')),'Delivery records store no invitation secrets';
  PERFORM public.admin_queue_student_invitation(actor,sid,op,'student.account.created',values1,sid);
  ASSERT (SELECT count(*)=1 FROM public.admin_audit_logs WHERE student_id=sid),'Queue replay creates no second event';
  ASSERT (SELECT student_number=assigned_number FROM public.profiles WHERE id=sid),'Queue replay keeps number';
  BEGIN
    PERFORM public.admin_claim_student_invitation(actor,sid,op,claim);
    RAISE EXCEPTION 'Expected lease requirement';
  EXCEPTION WHEN lock_not_available THEN NULL; END;
  PERFORM public.admin_begin_student_change(actor,sid,claim);
  result:=public.admin_claim_student_invitation(actor,sid,op,claim);
  ASSERT result->>'authId'=sid::text AND result->>'email'=email1,'Claim identifies the existing recipient';
  BEGIN
    PERFORM public.admin_claim_student_invitation(actor,sid,op,claim);
    RAISE EXCEPTION 'Expected duplicate claim rejection';
  EXCEPTION WHEN lock_not_available THEN NULL; END;
  BEGIN
    PERFORM public.admin_finish_student_invitation(actor,sid,gen_random_uuid(),'accepted');
    RAISE EXCEPTION 'Expected wrong claim rejection';
  EXCEPTION WHEN lock_not_available THEN NULL; END;
  result:=public.admin_finish_student_invitation(actor,sid,claim,'accepted');
  ASSERT result->>'status'='accepted','Provider acceptance saved';
  PERFORM public.admin_finish_student_invitation(actor,sid,claim,'accepted');
  PERFORM public.admin_end_student_change(sid,claim);
  PERFORM public.admin_begin_student_change(actor,sid,retry_op);
  PERFORM public.admin_queue_student_invitation(actor,sid,retry_op,'student.invitation.resent','{}',sid);
  ASSERT (SELECT count(*)=1 FROM public.profiles WHERE id=sid),'Resend reuses student';
  ASSERT (SELECT count(*)=2 FROM public.admin_audit_logs WHERE student_id=sid),'Resend request audited';
  PERFORM public.admin_begin_student_change(actor,sid,claim);
  PERFORM public.admin_claim_student_invitation(actor,sid,retry_op,claim);
  UPDATE private.sis_invitation_deliveries SET updated_at=now()-interval '6 minutes' WHERE student_id=sid;
  result:=public.admin_invitation_status(actor,sid);
  ASSERT result->>'status'='unknown' AND NOT (result->>'canRetry')::boolean,'Crashed sender requires review';
  BEGIN
    PERFORM public.admin_queue_student_invitation(actor,sid,gen_random_uuid(),'student.invitation.resent','{}',sid);
    RAISE EXCEPTION 'Expected unknown delivery retry rejection';
  EXCEPTION WHEN lock_not_available THEN NULL; END;
  PERFORM public.admin_end_student_change(sid,claim);
  -- Simulate a pending delivery left by a crash immediately after commit.
  UPDATE private.sis_invitation_deliveries SET status='queued',updated_at=now()-interval '2 hours' WHERE student_id=sid;
  result:=public.admin_invitation_status(actor,sid);
  ASSERT result->>'status'='queued' AND (result->>'canRetry')::boolean,'Pending delivery survives restart and uses a fresh link on retry';
  BEGIN
    PERFORM public.admin_invitation_status(sid,sid);
    RAISE EXCEPTION 'Expected student actor rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT NOT has_table_privilege('authenticated','private.sis_invitation_deliveries','SELECT'),'Browser cannot read delivery records directly';
  ASSERT NOT has_table_privilege('service_role','private.sis_invitation_deliveries','SELECT'),'Server must use guarded RPCs';
  ASSERT NOT has_function_privilege('authenticated','public.sis_expire_invitation_claims()','EXECUTE'),'Browser cannot expire delivery records';
  UPDATE private.sis_invitation_deliveries SET status='sending',updated_at=now()-interval '6 minutes' WHERE student_id=sid;
  ASSERT public.sis_expire_invitation_claims()>=1,'API maintenance expires interrupted claims';
  ASSERT (SELECT status='unknown' FROM private.sis_invitation_deliveries WHERE student_id=sid),'Interrupted sends require review';
  SELECT last_value INTO number_before FROM private.sis_student_number_counters WHERE year=to_char(now() AT TIME ZONE 'Asia/Manila','YYYY');
  -- A trigger failure after admin_write_student must roll back its entire transaction.
  CREATE FUNCTION private.reject_test_invitation() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN RAISE EXCEPTION 'Test delivery insert failure'; END;
  $fn$;
  CREATE TRIGGER reject_test_invitation BEFORE INSERT ON private.sis_invitation_deliveries
    FOR EACH ROW EXECUTE FUNCTION private.reject_test_invitation();
  BEGIN
    PERFORM public.admin_queue_student_invitation(actor,failed_sid,failed_op,'student.account.created',
      values1||jsonb_build_object('email',email2),failed_sid);
    RAISE EXCEPTION 'Expected delivery insertion failure';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM='Test delivery insert failure','Expected test trigger failure';
  END;
  ASSERT NOT EXISTS(SELECT 1 FROM public.users WHERE users_id=failed_sid),'Failed transaction left no directory';
  ASSERT NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=failed_sid),'Failed transaction left no profile';
  ASSERT NOT EXISTS(SELECT 1 FROM public.admin_audit_logs WHERE id=failed_op),'Failed transaction left no audit';
  ASSERT (SELECT last_value=number_before FROM private.sis_student_number_counters WHERE year=to_char(now() AT TIME ZONE 'Asia/Manila','YYYY')),'Failed transaction consumed no number';
  DROP TRIGGER reject_test_invitation ON private.sis_invitation_deliveries;
  DROP FUNCTION private.reject_test_invitation();
END;
$tests$;

SELECT 'SIS invitation delivery assertions passed; transaction must be rolled back.' AS result;
