-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.users (
  users_id uuid NOT NULL DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password text NOT NULL,
  role text NOT NULL DEFAULT 'Students'::text CHECK (role = ANY (ARRAY['Students'::text, 'Librarian'::text, 'Admin'::text])),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (users_id)
);
CREATE TABLE public.books (
  books_id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  author text NOT NULL,
  category text,
  publisher text,
  publication_year integer,
  copies integer NOT NULL DEFAULT 1 CHECK (copies >= 0),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT books_pkey PRIMARY KEY (books_id)
);
CREATE TABLE public.borrow_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  book_copy_id uuid,
  book_id uuid,
  issued_by uuid,
  borrow_date timestamp with time zone NOT NULL DEFAULT now(),
  due_date date NOT NULL DEFAULT (((now() AT TIME ZONE 'Asia/Manila'::text))::date + 14),
  daily_penalty_rate numeric NOT NULL DEFAULT 5.00,
  return_date timestamp with time zone,
  returned_to uuid,
  overdue_days integer NOT NULL DEFAULT 0,
  fine_amount numeric NOT NULL DEFAULT 0.00,
  fine_paid_at timestamp with time zone,
  receipt_number text UNIQUE,
  idempotency_key uuid DEFAULT gen_random_uuid() UNIQUE,
  CONSTRAINT borrow_records_pkey PRIMARY KEY (id),
  CONSTRAINT borrow_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(users_id),
  CONSTRAINT borrow_records_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(books_id),
  CONSTRAINT borrow_records_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(users_id),
  CONSTRAINT borrow_records_returned_to_fkey FOREIGN KEY (returned_to) REFERENCES public.users(users_id)
);
CREATE TABLE public.reservations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  book_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'fulfilled'::text, 'cancelled'::text, 'expired'::text])),
  reserved_by uuid NOT NULL,
  reserved_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '3 days'::interval),
  fulfilled_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  CONSTRAINT reservations_pkey PRIMARY KEY (id),
  CONSTRAINT reservations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(users_id),
  CONSTRAINT reservations_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(books_id),
  CONSTRAINT reservations_reserved_by_fkey FOREIGN KEY (reserved_by) REFERENCES public.users(users_id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  student_number character varying UNIQUE,
  first_name character varying NOT NULL,
  last_name character varying NOT NULL,
  email character varying NOT NULL UNIQUE,
  role USER-DEFINED NOT NULL DEFAULT 'student'::sis_user_role,
  academic_status USER-DEFINED NOT NULL DEFAULT 'active'::academic_status,
  department character varying,
  program character varying,
  year_level smallint CHECK (year_level >= 1 AND year_level <= 4),
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES public.users(users_id)
);
CREATE TABLE public.academic_terms (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  code character varying NOT NULL UNIQUE,
  name character varying NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT academic_terms_pkey PRIMARY KEY (id)
);
CREATE TABLE public.courses (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  course_code character varying NOT NULL UNIQUE,
  title character varying NOT NULL,
  description text,
  credits smallint NOT NULL CHECK (credits > 0),
  department character varying NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT courses_pkey PRIMARY KEY (id)
);
CREATE TABLE public.course_sections (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  course_id uuid NOT NULL,
  term_id uuid NOT NULL,
  section_number character varying NOT NULL DEFAULT '01'::character varying,
  instructor_name character varying,
  instructor_email character varying,
  schedule character varying,
  room character varying,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT course_sections_pkey PRIMARY KEY (id),
  CONSTRAINT course_sections_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id),
  CONSTRAINT course_sections_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.academic_terms(id)
);
CREATE TABLE public.academic_records (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL,
  section_id uuid NOT NULL,
  grade character varying CHECK (grade IS NULL OR (grade::text = ANY (ARRAY['A'::character varying, 'A-'::character varying, 'B+'::character varying, 'B'::character varying, 'B-'::character varying, 'C+'::character varying, 'C'::character varying, 'C-'::character varying, 'D'::character varying, 'F'::character varying, 'IP'::character varying, 'W'::character varying]::text[]))),
  is_current boolean NOT NULL DEFAULT false,
  recorded_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT academic_records_pkey PRIMARY KEY (id),
  CONSTRAINT academic_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id),
  CONSTRAINT academic_records_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.course_sections(id)
);
CREATE TABLE public.student_holds (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL,
  hold_type USER-DEFINED NOT NULL,
  reason text NOT NULL,
  placed_by_system character varying NOT NULL DEFAULT 'Frighton SIS'::character varying,
  placed_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  resolved_at timestamp with time zone,
  CONSTRAINT student_holds_pkey PRIMARY KEY (id),
  CONSTRAINT student_holds_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.student_accounts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL,
  term_id uuid NOT NULL,
  base_tuition numeric NOT NULL DEFAULT 0 CHECK (base_tuition >= 0::numeric),
  mandatory_fees numeric NOT NULL DEFAULT 0 CHECK (mandatory_fees >= 0::numeric),
  scholarships numeric NOT NULL DEFAULT 0 CHECK (scholarships >= 0::numeric),
  status USER-DEFINED NOT NULL DEFAULT 'open'::account_status,
  due_date date,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT student_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT student_accounts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id),
  CONSTRAINT student_accounts_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.academic_terms(id)
);
CREATE TABLE public.student_payments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  account_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  reference_number character varying NOT NULL UNIQUE,
  receipt_status character varying NOT NULL DEFAULT 'completed'::character varying CHECK (receipt_status::text = ANY (ARRAY['pending'::character varying, 'completed'::character varying, 'void'::character varying]::text[])),
  paid_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT student_payments_pkey PRIMARY KEY (id),
  CONSTRAINT student_payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.student_accounts(id)
);