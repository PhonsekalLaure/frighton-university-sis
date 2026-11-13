BEGIN;

CREATE TABLE private.sis_invitation_deliveries (
  student_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  auth_id uuid NOT NULL,
  operation_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('queued','sending','accepted','failed','unknown')),
  claim_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.sis_invitation_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.sis_invitation_deliveries FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.sis_invitation_summary(p_student_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('status',CASE WHEN status='sending' AND updated_at<now()-interval '5 minutes' THEN 'unknown' ELSE status END,
    'canRetry',status IN ('queued','accepted','failed'),'updatedAt',updated_at)
  FROM private.sis_invitation_deliveries WHERE student_id=p_student_id;
$$;
REVOKE ALL ON FUNCTION private.sis_invitation_summary(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.admin_invitation_ready(p_actor_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.admin_actor(p_actor_id);
  RETURN true;
END;
$$;

CREATE FUNCTION public.sis_expire_invitation_claims() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected integer;
BEGIN
  UPDATE private.sis_invitation_deliveries SET status='unknown',updated_at=clock_timestamp()
    WHERE status='sending' AND updated_at<now()-interval '5 minutes';
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE FUNCTION public.sis_invitation_delivery_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_regclass('private.sis_invitation_deliveries') IS NOT NULL;
$$;

CREATE FUNCTION public.admin_invitation_status(p_actor_id uuid,p_student_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.admin_get_student(p_actor_id,p_student_id);
  -- A crashed sender is uncertain, never an automatically retryable failure.
  UPDATE private.sis_invitation_deliveries SET status='unknown',updated_at=clock_timestamp()
    WHERE student_id=p_student_id AND status='sending' AND updated_at<now()-interval '5 minutes';
  RETURN private.sis_invitation_summary(p_student_id);
END;
$$;

-- Account/profile/number/audit and the pending delivery request commit together.
-- Auth and SMTP are external operations and never execute inside this transaction.
CREATE FUNCTION public.admin_queue_student_invitation(p_actor_id uuid,p_student_id uuid,p_operation_id uuid,
  p_action text,p_values jsonb,p_auth_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE student jsonb; prior private.sis_invitation_deliveries%ROWTYPE; existing public.admin_audit_logs%ROWTYPE;
BEGIN
  PERFORM private.admin_actor(p_actor_id);
  IF p_action IS NULL OR p_action NOT IN ('student.account.created','student.invitation.resent') THEN
    RAISE EXCEPTION 'Invalid invitation request.' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing FROM public.admin_audit_logs WHERE id=p_operation_id;
  IF FOUND THEN
    IF existing.actor_id<>p_actor_id OR existing.student_id<>p_student_id OR existing.action<>p_action THEN
      RAISE EXCEPTION 'Operation conflicts with an existing request.' USING ERRCODE='23505'; END IF;
    RETURN public.admin_get_student(p_actor_id,p_student_id);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users a WHERE a.id=p_auth_id AND a.invited_at IS NOT NULL
    AND a.email_confirmed_at IS NULL AND lower(a.email)=lower(CASE WHEN p_action='student.account.created'
      THEN p_values->>'email' ELSE (SELECT email FROM public.profiles WHERE id=p_student_id) END)) THEN
    RAISE EXCEPTION 'Matching unconfirmed Auth identity required.' USING ERRCODE='22023'; END IF;
  IF p_action='student.account.created' AND (p_auth_id<>p_student_id OR NOT EXISTS(
    SELECT 1 FROM auth.users WHERE id=p_auth_id AND raw_user_meta_data->>'sis_provisioning_operation_id'=p_operation_id::text)) THEN
    RAISE EXCEPTION 'Provisioning ownership could not be confirmed.' USING ERRCODE='22023'; END IF;
  SELECT * INTO prior FROM private.sis_invitation_deliveries WHERE student_id=p_student_id FOR UPDATE;
  IF FOUND AND prior.status IN ('sending','unknown') THEN
    RAISE EXCEPTION 'Invitation delivery requires review.' USING ERRCODE='55P03'; END IF;
  student := public.admin_write_student(p_actor_id,p_student_id,p_operation_id,p_action,p_values);
  INSERT INTO private.sis_invitation_deliveries(student_id,auth_id,operation_id,status)
    VALUES(p_student_id,p_auth_id,p_operation_id,'queued')
  ON CONFLICT(student_id) DO UPDATE SET auth_id=excluded.auth_id,operation_id=excluded.operation_id,
    status='queued',claim_id=NULL,updated_at=clock_timestamp();
  RETURN student;
END;
$$;

CREATE FUNCTION public.admin_claim_student_invitation(p_actor_id uuid,p_student_id uuid,p_operation_id uuid,p_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE job private.sis_invitation_deliveries%ROWTYPE; student jsonb;
BEGIN
  student := public.admin_get_student(p_actor_id,p_student_id);
  IF NOT EXISTS(SELECT 1 FROM private.admin_student_locks WHERE student_id=p_student_id AND operation_id=p_claim_id
    AND expires_at>now()) THEN RAISE EXCEPTION 'Account lease required.' USING ERRCODE='55P03'; END IF;
  SELECT * INTO job FROM private.sis_invitation_deliveries WHERE student_id=p_student_id FOR UPDATE;
  IF NOT FOUND OR job.operation_id IS DISTINCT FROM p_operation_id OR job.status<>'queued' THEN
    RAISE EXCEPTION 'Invitation cannot be claimed.' USING ERRCODE='55P03'; END IF;
  IF NOT (student->>'isActive')::boolean OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=job.auth_id
    AND email_confirmed_at IS NULL AND lower(email)=lower(student->>'email')) THEN
    UPDATE private.sis_invitation_deliveries SET status='failed',updated_at=clock_timestamp()
      WHERE student_id=p_student_id;
    RETURN NULL;
  END IF;
  UPDATE private.sis_invitation_deliveries SET status='sending',claim_id=p_claim_id,updated_at=clock_timestamp()
    WHERE student_id=p_student_id;
  RETURN jsonb_build_object('authId',job.auth_id,'email',student->>'email');
END;
$$;

CREATE FUNCTION public.admin_finish_student_invitation(p_actor_id uuid,p_student_id uuid,p_claim_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.admin_get_student(p_actor_id,p_student_id);
  IF p_status NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'Invalid delivery state.' USING ERRCODE='22023'; END IF;
  UPDATE private.sis_invitation_deliveries SET status=p_status,updated_at=clock_timestamp()
    WHERE student_id=p_student_id AND claim_id=p_claim_id AND status='sending';
  IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM private.sis_invitation_deliveries
    WHERE student_id=p_student_id AND claim_id=p_claim_id AND status=p_status) THEN
    RAISE EXCEPTION 'Delivery state changed.' USING ERRCODE='55P03'; END IF;
  RETURN private.sis_invitation_summary(p_student_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_invitation_status(uuid,uuid),
  public.sis_expire_invitation_claims(),
  public.sis_invitation_delivery_ready(),
  public.admin_invitation_ready(uuid),
  public.admin_queue_student_invitation(uuid,uuid,uuid,text,jsonb,uuid),
  public.admin_claim_student_invitation(uuid,uuid,uuid,uuid),
  public.admin_finish_student_invitation(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_invitation_status(uuid,uuid),
  public.sis_expire_invitation_claims(),
  public.sis_invitation_delivery_ready(),
  public.admin_invitation_ready(uuid),
  public.admin_queue_student_invitation(uuid,uuid,uuid,text,jsonb,uuid),
  public.admin_claim_student_invitation(uuid,uuid,uuid,uuid),
  public.admin_finish_student_invitation(uuid,uuid,uuid,text) TO service_role;

COMMIT;
