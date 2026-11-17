BEGIN;

-- Setup's service-only guard and atomic SQL deletion. Auth deletion remains an
-- external API operation; preview runs before it and every SQL check is repeated.
CREATE FUNCTION public.sis_setup_student_account(p_student_id uuid,p_email text,p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE directory public.users%ROWTYPE; profile public.profiles%ROWTYPE; dependency record;
  referenced boolean; has_outbox boolean := false; snapshot jsonb; lease timestamptz; deleted_count integer;
BEGIN
  SELECT * INTO directory FROM public.users WHERE users_id=p_student_id FOR UPDATE;
  IF NOT FOUND OR lower(btrim(directory.role)) NOT IN ('student','students') OR
    lower(directory.email) IS DISTINCT FROM lower(p_email) THEN
    RETURN jsonb_build_object('ready',false,'reason','identity_changed');
  END IF;
  SELECT * INTO profile FROM public.profiles WHERE id=p_student_id FOR UPDATE;
  IF NOT FOUND OR profile.role::text<>'student' OR lower(profile.email) IS DISTINCT FROM lower(p_email) THEN
    RETURN jsonb_build_object('ready',false,'reason','identity_changed');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.conrelid='public.profiles'::regclass AND c.confrelid='public.users'::regclass
      AND a.attname='id' AND array_length(c.conkey,1)=1 AND c.confdeltype='c') THEN
    RETURN jsonb_build_object('ready',false,'reason','schema_not_ready');
  END IF;

  -- Inspect actual FKs, including references added after this script was written.
  -- Only the SIS profile and a verified empty outbox entry may be removed here.
  FOR dependency IN
    SELECT n.nspname AS schema_name,r.relname AS table_name,a.attname AS column_name,
      target.attname AS target_column,array_length(c.conkey,1) AS column_count
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    JOIN pg_catalog.pg_attribute target ON target.attrelid=c.confrelid AND target.attnum=c.confkey[1]
    WHERE c.contype='f' AND c.confrelid='public.users'::regclass
  LOOP
    IF dependency.column_count<>1 OR dependency.target_column<>'users_id' THEN
      RETURN jsonb_build_object('ready',false,'reason','unsupported_reference');
    END IF;
    IF dependency.schema_name='public' AND
      ((dependency.table_name='profiles' AND dependency.column_name='id') OR
       (dependency.table_name='library_debt_outbox' AND dependency.column_name='student_id')) THEN CONTINUE; END IF;
    EXECUTE pg_catalog.format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',
      dependency.schema_name,dependency.table_name,dependency.column_name) INTO referenced USING p_student_id;
    IF referenced THEN
      RETURN jsonb_build_object('ready',false,'reason','linked_records','table',dependency.table_name);
    END IF;
  END LOOP;

  IF pg_catalog.to_regclass('public.library_debt_outbox') IS NOT NULL THEN
    SELECT payload,locked_until INTO snapshot,lease FROM public.library_debt_outbox
      WHERE student_id=p_student_id FOR UPDATE;
    has_outbox := FOUND;
    IF has_outbox THEN
      IF profile.student_number IS NULL OR NOT (snapshot @> jsonb_build_object(
        'studentNumber',profile.student_number,'qualifyingDebtCount',0,'amount',0,'currency','PHP')) THEN
        RETURN jsonb_build_object('ready',false,'reason','outbox_nonzero');
      END IF;
      IF lease>clock_timestamp() THEN
        RETURN jsonb_build_object('ready',false,'reason','outbox_in_flight');
      END IF;
    END IF;
  END IF;

  IF p_apply THEN
    IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_student_id OR lower(email)=lower(p_email)) THEN
      RETURN jsonb_build_object('ready',false,'reason','auth_still_exists');
    END IF;
    DELETE FROM public.sis_library_debt_state WHERE student_id=p_student_id;
    IF has_outbox THEN DELETE FROM public.library_debt_outbox WHERE student_id=p_student_id; END IF;
    DELETE FROM public.users WHERE users_id=p_student_id;
    GET DIAGNOSTICS deleted_count=ROW_COUNT;
    IF deleted_count<>1 THEN RAISE EXCEPTION 'Student directory deletion did not complete.' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN jsonb_build_object('ready',true,'deleted',p_apply,'emptyOutboxRemoved',p_apply AND has_outbox);
END;
$$;

REVOKE ALL ON FUNCTION public.sis_setup_student_account(uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sis_setup_student_account(uuid,text,boolean) TO service_role;

COMMIT;
