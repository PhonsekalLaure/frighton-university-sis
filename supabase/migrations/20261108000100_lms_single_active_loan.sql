-- Requires migrations 003 through 007.
-- borrow_book checks this policy while holding the student row lock, so
-- simultaneous checkouts cannot create a second active loan.
-- Existing loans and return history are preserved.
BEGIN;

CREATE OR REPLACE FUNCTION public.circulation_policy()
RETURNS TABLE (
    time_zone TEXT,
    loan_period_days INTEGER,
    max_active_loans INTEGER,
    daily_penalty_rate NUMERIC,
    today DATE,
    due_date DATE
)
LANGUAGE sql STABLE SET search_path = '' AS $$
    WITH settings AS (
        SELECT 'Asia/Manila'::text AS time_zone, 14 AS loan_period_days,
               1 AS max_active_loans, 5.00::numeric AS daily_penalty_rate
    ), dated AS (
        SELECT settings.*, (now() AT TIME ZONE settings.time_zone)::date AS today
        FROM settings
    )
    SELECT dated.*, dated.today + dated.loan_period_days FROM dated;
$$;

REVOKE ALL ON FUNCTION public.circulation_policy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.circulation_policy() TO service_role;

COMMIT;