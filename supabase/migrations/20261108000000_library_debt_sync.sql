BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT student_id FROM public.student_holds WHERE hold_type='library_debt' AND placed_by_system='Frighton LMS' AND resolved_at IS NULL GROUP BY student_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Duplicate active LMS debt holds exist. Reconcile with library staff before applying this migration.';
 END IF;
END $$;
CREATE UNIQUE INDEX sis_one_active_lms_debt ON public.student_holds(student_id)
 WHERE hold_type='library_debt' AND placed_by_system='Frighton LMS' AND resolved_at IS NULL;
CREATE TABLE public.sis_library_debt_state (
 student_id uuid PRIMARY KEY REFERENCES public.profiles(id),version bigint NOT NULL DEFAULT 0,
 qualifying_debt_count integer NOT NULL DEFAULT 0,amount numeric NOT NULL DEFAULT 0 CHECK(amount>=0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sis_library_debt_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sis_library_debt_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sis_library_debt_state TO service_role;
CREATE FUNCTION public.apply_library_debt(p_student_number text,p_version bigint,p_count integer,p_amount numeric,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_student uuid; v_state public.sis_library_debt_state; v_hold public.student_holds;
BEGIN
 IF p_version<1 OR p_count<0 OR p_amount<0 OR (p_count=0 AND p_amount<>0) OR length(p_reason)>1000 THEN
  RAISE SQLSTATE 'PT400' USING MESSAGE='Invalid debt snapshot.'; END IF;
 SELECT id INTO v_student FROM public.profiles WHERE student_number=p_student_number AND role::text='student';
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Student was not found.'; END IF;
 INSERT INTO public.sis_library_debt_state(student_id) VALUES(v_student) ON CONFLICT DO NOTHING;
 SELECT * INTO v_state FROM public.sis_library_debt_state WHERE student_id=v_student FOR UPDATE;
 IF p_version<=v_state.version THEN RETURN jsonb_build_object('applied',false,'version',v_state.version); END IF;
 IF p_count>0 THEN
  INSERT INTO public.student_holds(student_id,hold_type,reason,placed_by_system)
  VALUES(v_student,'library_debt',p_reason,'Frighton LMS')
  ON CONFLICT(student_id) WHERE hold_type='library_debt' AND placed_by_system='Frighton LMS' AND resolved_at IS NULL
  DO UPDATE SET reason=excluded.reason RETURNING * INTO v_hold;
 ELSE
  UPDATE public.student_holds SET resolved_at=now() WHERE student_id=v_student AND hold_type='library_debt'
   AND placed_by_system='Frighton LMS' AND resolved_at IS NULL RETURNING * INTO v_hold;
 END IF;
 UPDATE public.sis_library_debt_state SET version=p_version,qualifying_debt_count=p_count,amount=p_amount,updated_at=now() WHERE student_id=v_student;
 RETURN jsonb_build_object('applied',true,'version',p_version,'hold',to_jsonb(v_hold));
END $$;
REVOKE ALL ON FUNCTION public.apply_library_debt(text,bigint,integer,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_library_debt(text,bigint,integer,numeric,text) TO service_role;
COMMIT;
