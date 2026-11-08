-- Forward-only. Requires the shared production schema and migrations 003–008.
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.reservations r JOIN public.books b ON b.books_id=r.book_id
      WHERE r.status='active' AND r.expires_at>now() GROUP BY b.books_id,b.copies HAVING count(*)>b.copies) THEN
    RAISE EXCEPTION 'Existing reservations exceed stock. Reconcile with library staff before applying 009.';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.catalog_books WITH (security_invoker=true) AS
SELECT b.books_id AS id,b.title,b.author,coalesce(b.category,'') AS category,b.publication_year AS year,
  (b.copies-(SELECT count(*)::integer FROM public.reservations r WHERE r.book_id=b.books_id AND r.status='active' AND r.expires_at>now()))::integer AS available,
  b.copies+(SELECT count(*) FROM public.borrow_records l WHERE l.book_id=b.books_id AND l.return_date IS NULL) AS total,
  b.shelf_location AS shelf,b.is_active AS active,b.copies AS physical_available
FROM public.books b;

CREATE OR REPLACE VIEW public.circulation_reservations WITH (security_invoker=true) AS
SELECT r.id,r.status,r.reserved_at,r.expires_at,p.student_number,
 concat_ws(' ',u.first_name,u.middle_name,u.last_name) AS student_name,
 b.books_id AS book_id,b.title AS book_title,b.author AS book_author,c.available AS available_copies
FROM public.reservations r JOIN public.users u ON u.users_id=r.student_id
JOIN public.profiles p ON p.id=u.users_id JOIN public.books b ON b.books_id=r.book_id
JOIN public.catalog_books c ON c.id=b.books_id;

-- Stock edits are also made directly by the staff repository. Enforce the floor there too.
CREATE OR REPLACE FUNCTION public.library_stock_floor() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF OLD.is_active AND NOT NEW.is_active AND EXISTS (SELECT 1 FROM public.reservations WHERE book_id=NEW.books_id AND status='active' AND expires_at>now()) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE='Cancel or fulfil active pickup reservations before archiving this book.';
  END IF;
  IF NEW.copies < (SELECT count(*) FROM public.reservations WHERE book_id=NEW.books_id AND status='active' AND expires_at>now()) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE='Total stock cannot be less than checked-out and reserved copies.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER library_stock_floor BEFORE UPDATE OF copies,is_active ON public.books
FOR EACH ROW EXECUTE FUNCTION public.library_stock_floor();

CREATE OR REPLACE FUNCTION public.library_create_reservation(p_student_number text,p_book_id uuid,p_actor uuid,p_self_service boolean)
RETURNS public.reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_student uuid; v_book public.books; v_result public.reservations;
BEGIN
  SELECT u.users_id INTO v_student FROM public.users u JOIN public.profiles p ON p.id=u.users_id
   WHERE p.student_number=upper(trim(p_student_number)) AND u.role='Students' AND u.is_active
   AND p.role::text='student' AND p.academic_status::text='active' FOR UPDATE OF u,p;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT403' USING MESSAGE='An active student is required.'; END IF;
  IF p_self_service THEN p_actor:=v_student;
  ELSIF NOT EXISTS (SELECT 1 FROM public.users WHERE users_id=p_actor AND is_active AND role IN ('Librarian','Admin')) THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE='An active staff account is required.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.borrow_records WHERE student_id=v_student AND return_date IS NULL) THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE='Return all borrowed books before reserving.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.library_replacement_charges WHERE student_id=v_student AND settled_at IS NULL) THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE='Clear unpaid replacement charges before reserving.';
  END IF;
  SELECT * INTO v_book FROM public.books WHERE books_id=p_book_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Book was not found or has been archived.'; END IF;
  UPDATE public.reservations SET status='expired' WHERE student_id=v_student AND book_id=p_book_id AND status='active' AND expires_at<=now();
  IF EXISTS (SELECT 1 FROM public.reservations WHERE student_id=v_student AND book_id=p_book_id AND status='active') THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE='An active reservation already exists for this book.';
  END IF;
  IF v_book.copies <= (SELECT count(*) FROM public.reservations WHERE book_id=p_book_id AND status='active' AND expires_at>now()) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE='No copies are available for reservation.';
  END IF;
  INSERT INTO public.reservations(student_id,book_id,reserved_by) VALUES(v_student,p_book_id,p_actor) RETURNING * INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.create_reservation(p_student_number text,p_book_id uuid,p_reserved_by uuid)
RETURNS public.reservations LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.library_create_reservation(p_student_number,p_book_id,p_reserved_by,false);
$$;
CREATE FUNCTION public.create_self_service_reservation(p_student_number text,p_book_id uuid)
RETURNS public.reservations LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.library_create_reservation(p_student_number,p_book_id,NULL,true);
$$;

CREATE FUNCTION public.cancel_self_service_reservation(p_student_number text,p_reservation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_student uuid; v_book uuid; v_result public.reservations;
BEGIN
  SELECT id INTO v_student FROM public.profiles WHERE student_number=p_student_number;
  SELECT book_id INTO v_book FROM public.reservations WHERE id=p_reservation_id AND student_id=v_student;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Reservation was not found.'; END IF;
  PERFORM 1 FROM public.users WHERE users_id=v_student FOR UPDATE;
  PERFORM 1 FROM public.books WHERE books_id=v_book FOR UPDATE;
  SELECT * INTO v_result FROM public.reservations WHERE id=p_reservation_id AND student_id=v_student FOR UPDATE;
  IF v_result.status='cancelled' THEN RETURN; END IF;
  IF v_result.status<>'active' OR v_result.expires_at<=now() THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE='Reservation has expired or was fulfilled.';
  END IF;
  UPDATE public.reservations SET status='cancelled',cancelled_at=now() WHERE id=p_reservation_id;
END $$;

CREATE OR REPLACE FUNCTION public.borrow_book(p_student_number text,p_book_id uuid,p_issued_by uuid)
RETURNS public.borrow_records LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_student uuid; v_book public.books; v_reservation uuid; v_loan public.borrow_records; v_policy record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE users_id=p_issued_by AND is_active AND role IN ('Librarian','Admin')) THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE='An active staff account is required.'; END IF;
  SELECT u.users_id INTO v_student FROM public.users u JOIN public.profiles p ON p.id=u.users_id
   WHERE p.student_number=upper(trim(p_student_number)) AND u.role='Students' AND u.is_active
   AND p.role::text='student' AND p.academic_status::text='active' FOR UPDATE OF u,p;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT403' USING MESSAGE='An active student is required.'; END IF;
  IF EXISTS (SELECT 1 FROM public.borrow_records WHERE student_id=v_student AND return_date IS NULL) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE='This student already has an active loan.'; END IF;
  IF EXISTS (SELECT 1 FROM public.library_replacement_charges WHERE student_id=v_student AND settled_at IS NULL) THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE='Clear unpaid replacement charges before borrowing.'; END IF;
  SELECT * INTO v_book FROM public.books WHERE books_id=p_book_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Book was not found or has been archived.'; END IF;
  SELECT id INTO v_reservation FROM public.reservations WHERE student_id=v_student AND book_id=p_book_id AND status='active' AND expires_at>now() FOR UPDATE;
  IF v_reservation IS NULL AND v_book.copies <= (SELECT count(*) FROM public.reservations WHERE book_id=p_book_id AND status='active' AND expires_at>now()) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE='No unreserved copies are available.'; END IF;
  IF v_book.copies<1 THEN RAISE SQLSTATE 'PT409' USING MESSAGE='No copies are available.'; END IF;
  SELECT * INTO v_policy FROM public.circulation_policy();
  INSERT INTO public.borrow_records(student_id,book_id,issued_by,due_date,daily_penalty_rate)
   VALUES(v_student,p_book_id,p_issued_by,v_policy.due_date,v_policy.daily_penalty_rate) RETURNING * INTO v_loan;
  -- Release the allocation before decrementing physical stock (stock floor trigger).
  IF v_reservation IS NOT NULL THEN UPDATE public.reservations SET status='fulfilled',fulfilled_at=now() WHERE id=v_reservation; END IF;
  UPDATE public.books SET copies=copies-1 WHERE books_id=p_book_id;
  RETURN v_loan;
END $$;

CREATE TABLE public.library_replacement_charges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),student_id uuid NOT NULL REFERENCES public.users(users_id),
 loan_id uuid REFERENCES public.borrow_records(id),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 amount numeric(12,2) NOT NULL CHECK(amount>0),currency text NOT NULL DEFAULT 'PHP' CHECK(currency='PHP'),
 assessed_by uuid NOT NULL REFERENCES public.users(users_id),assessed_at timestamptz NOT NULL DEFAULT now(),
 settled_by uuid REFERENCES public.users(users_id),settled_at timestamptz,settlement_reference text,
 CHECK ((settled_at IS NULL AND settled_by IS NULL AND settlement_reference IS NULL) OR
 (settled_at IS NOT NULL AND settled_by IS NOT NULL AND length(trim(settlement_reference)) BETWEEN 1 AND 200))
);
CREATE INDEX library_unpaid_replacements ON public.library_replacement_charges(student_id) WHERE settled_at IS NULL;
ALTER TABLE public.library_replacement_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_replacement_charges FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.library_replacement_charges TO service_role;

CREATE TABLE public.library_debt_outbox (
 student_id uuid PRIMARY KEY REFERENCES public.users(users_id),version bigint NOT NULL DEFAULT 1,
 payload jsonb NOT NULL,delivered_version bigint NOT NULL DEFAULT 0,attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),locked_until timestamptz,claim_token uuid,
 updated_at timestamptz NOT NULL DEFAULT now(),last_delivered_at timestamptz
);
ALTER TABLE public.library_debt_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_debt_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.library_debt_outbox TO service_role;

CREATE FUNCTION public.refresh_library_debt(p_student_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_number text; v_count integer; v_amount numeric; v_payload jsonb; v_row public.library_debt_outbox;
BEGIN
 SELECT p.student_number INTO v_number FROM public.profiles p JOIN public.users u ON u.users_id=p.id WHERE p.id=p_student_id AND p.role::text='student' FOR UPDATE OF u;
 IF v_number IS NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Student was not found.'; END IF;
 SELECT count(*)::integer,coalesce(sum(amount),0) INTO v_count,v_amount FROM (
   SELECT ((now() AT TIME ZONE 'Asia/Manila')::date-due_date)*daily_penalty_rate AS amount FROM public.borrow_records
    WHERE student_id=p_student_id AND return_date IS NULL AND (now() AT TIME ZONE 'Asia/Manila')::date-due_date>=14
   UNION ALL SELECT amount FROM public.library_replacement_charges WHERE student_id=p_student_id AND settled_at IS NULL
 ) debts;
 v_payload:=jsonb_build_object('studentNumber',v_number,'qualifyingDebtCount',v_count,'amount',v_amount,'currency','PHP',
  'reason',CASE WHEN v_count>0 THEN 'Library debt: '||v_count||' qualifying item(s); PHP '||v_amount ELSE 'No qualifying library debt' END);
 INSERT INTO public.library_debt_outbox(student_id,payload) VALUES(p_student_id,v_payload)
 ON CONFLICT(student_id) DO UPDATE SET payload=excluded.payload,version=public.library_debt_outbox.version+1,
  attempts=0,next_attempt_at=now(),locked_until=NULL,claim_token=NULL,updated_at=now()
 WHERE public.library_debt_outbox.payload IS DISTINCT FROM excluded.payload;
 SELECT * INTO v_row FROM public.library_debt_outbox WHERE student_id=p_student_id;
 RETURN v_row.payload||jsonb_build_object('version',v_row.version);
END $$;

CREATE FUNCTION public.library_debt_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 -- Historical LMS borrowers may not have a numbered SIS profile. A return must
 -- still complete; only numbered student profiles participate in SIS debt sync.
 IF EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.student_id AND role::text='student' AND student_number IS NOT NULL) THEN
  PERFORM public.refresh_library_debt(NEW.student_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER library_loan_debt_changed AFTER INSERT OR UPDATE ON public.borrow_records FOR EACH ROW EXECUTE FUNCTION public.library_debt_changed();
CREATE TRIGGER library_charge_debt_changed AFTER INSERT OR UPDATE ON public.library_replacement_charges FOR EACH ROW EXECUTE FUNCTION public.library_debt_changed();

CREATE FUNCTION public.record_library_replacement(p_student_number text,p_reason text,p_amount numeric,p_loan_id uuid,p_actor uuid)
RETURNS public.library_replacement_charges LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_student uuid; v_charge public.library_replacement_charges;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.users WHERE users_id=p_actor AND is_active AND role IN ('Librarian','Admin')) THEN RAISE SQLSTATE 'PT403' USING MESSAGE='An active staff account is required.'; END IF;
 SELECT u.users_id INTO v_student FROM public.users u JOIN public.profiles p ON p.id=u.users_id WHERE p.student_number=p_student_number AND p.role::text='student' FOR UPDATE OF u;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Student was not found.'; END IF;
 IF p_loan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.borrow_records WHERE id=p_loan_id AND student_id=v_student) THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Student loan was not found.'; END IF;
 INSERT INTO public.library_replacement_charges(student_id,loan_id,reason,amount,assessed_by)
 VALUES(v_student,p_loan_id,p_reason,p_amount,p_actor) RETURNING * INTO v_charge;
 RETURN v_charge;
END $$;
CREATE FUNCTION public.settle_library_replacement(p_id uuid,p_reference text,p_actor uuid)
RETURNS public.library_replacement_charges LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_student uuid; v_charge public.library_replacement_charges;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.users WHERE users_id=p_actor AND is_active AND role IN ('Librarian','Admin')) THEN RAISE SQLSTATE 'PT403' USING MESSAGE='An active staff account is required.'; END IF;
 SELECT student_id INTO v_student FROM public.library_replacement_charges WHERE id=p_id;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Charge was not found.'; END IF;
 PERFORM 1 FROM public.users WHERE users_id=v_student FOR UPDATE;
 SELECT * INTO v_charge FROM public.library_replacement_charges WHERE id=p_id FOR UPDATE;
 IF v_charge.settled_at IS NOT NULL THEN RETURN v_charge; END IF;
 UPDATE public.library_replacement_charges SET settled_at=now(),settled_by=p_actor,settlement_reference=p_reference WHERE id=p_id RETURNING * INTO v_charge;
 RETURN v_charge;
END $$;

CREATE FUNCTION public.claim_library_debt(p_limit integer DEFAULT 20) RETURNS SETOF public.library_debt_outbox
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE public.library_debt_outbox o SET locked_until=now()+interval '2 minutes',claim_token=gen_random_uuid()
 WHERE o.student_id IN (SELECT student_id FROM public.library_debt_outbox WHERE delivered_version<version AND next_attempt_at<=now()
  AND (locked_until IS NULL OR locked_until<=now()) ORDER BY next_attempt_at LIMIT least(greatest(p_limit,1),100) FOR UPDATE SKIP LOCKED) RETURNING o.*;
$$;
CREATE FUNCTION public.finish_library_debt(p_student_id uuid,p_version bigint,p_token uuid,p_success boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE public.library_debt_outbox SET delivered_version=CASE WHEN p_success THEN p_version ELSE delivered_version END,
  last_delivered_at=CASE WHEN p_success THEN now() ELSE last_delivered_at END,
  attempts=CASE WHEN p_success THEN 0 ELSE attempts+1 END,
  next_attempt_at=now()+make_interval(secs=>CASE WHEN p_success THEN 0 ELSE least(3600,30*power(2,least(attempts,7))::integer) END),
  locked_until=NULL,claim_token=NULL WHERE student_id=p_student_id AND version=p_version AND claim_token=p_token;
$$;

-- Only the service role may enter privileged functions. No browser roles gain table writes.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('library_create_reservation','create_self_service_reservation','cancel_self_service_reservation',
 'refresh_library_debt','library_debt_changed','record_library_replacement','settle_library_replacement','claim_library_debt','finish_library_debt','library_stock_floor') LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
 END LOOP;
END $$;
COMMIT;
