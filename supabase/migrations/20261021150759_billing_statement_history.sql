-- Historical, cashier-posted billing statements for the SIS demo. The portal
-- remains read-only: these are accounting snapshots, not payment-gateway data.
WITH historical_accounts (
  student_number, term_code, base_tuition, mandatory_fees, scholarships, status, due_date
) AS (
  VALUES
    ('STU-2026-0001', 'FALL-2025', 4200, 300, 0, 'paid', DATE '2025-11-15'),
    ('STU-2026-0002', 'FALL-2025', 4800, 300, 0, 'paid', DATE '2025-11-15'),
    ('STU-2026-0003', 'FALL-2025', 4600, 250, 0, 'paid', DATE '2025-11-15'),
    ('STU-2026-0004', 'FALL-2025', 5200, 350, 1300, 'paid', DATE '2025-11-15'),
    ('STU-2026-0005', 'FALL-2025', 4200, 300, 0, 'paid', DATE '2025-11-15'),
    ('STU-2026-0006', 'FALL-2025', 4600, 250, 400, 'paid', DATE '2025-11-15'),
    ('STU-2026-0007', 'FALL-2025', 4800, 300, 400, 'paid', DATE '2025-11-15'),
    ('STU-2026-0008', 'FALL-2025', 5200, 350, 900, 'paid', DATE '2025-11-15'),
    ('STU-2026-0009', 'FALL-2025', 4200, 300, 750, 'paid', DATE '2025-11-15'),
    ('STU-2026-0010', 'FALL-2025', 4600, 250, 0, 'paid', DATE '2025-11-15'),
    ('STU-2026-0001', 'SPRING-2026', 4300, 300, 0, 'paid', DATE '2026-04-15'),
    ('STU-2026-0002', 'SPRING-2026', 4900, 300, 0, 'paid', DATE '2026-04-15'),
    ('STU-2026-0003', 'SPRING-2026', 4700, 250, 0, 'paid', DATE '2026-04-15'),
    ('STU-2026-0004', 'SPRING-2026', 5300, 350, 1400, 'paid', DATE '2026-04-15'),
    ('STU-2026-0005', 'SPRING-2026', 4300, 300, 0, 'paid', DATE '2026-04-15'),
    ('STU-2026-0006', 'SPRING-2026', 4700, 250, 450, 'paid', DATE '2026-04-15'),
    ('STU-2026-0007', 'SPRING-2026', 4900, 300, 500, 'paid', DATE '2026-04-15'),
    ('STU-2026-0008', 'SPRING-2026', 5300, 350, 950, 'paid', DATE '2026-04-15'),
    ('STU-2026-0009', 'SPRING-2026', 4300, 300, 800, 'paid', DATE '2026-04-15'),
    ('STU-2026-0010', 'SPRING-2026', 4700, 250, 0, 'paid', DATE '2026-04-15')
)
INSERT INTO public.student_accounts (
  student_id, term_id, base_tuition, mandatory_fees, scholarships, status, due_date
)
SELECT profile.id, term.id, source.base_tuition, source.mandatory_fees,
  source.scholarships, source.status::public.account_status, source.due_date
FROM historical_accounts AS source
JOIN public.profiles AS profile ON profile.student_number = source.student_number
JOIN public.academic_terms AS term ON term.code = source.term_code
ON CONFLICT (student_id, term_id) DO UPDATE
SET base_tuition = EXCLUDED.base_tuition,
    mandatory_fees = EXCLUDED.mandatory_fees,
    scholarships = EXCLUDED.scholarships,
    status = EXCLUDED.status,
    due_date = EXCLUDED.due_date,
    updated_at = timezone('utc'::text, now());

WITH historical_payments (student_number, term_code, amount, reference_number, paid_at) AS (
  VALUES
    ('STU-2026-0001', 'FALL-2025', 4500, 'REC-2025-0001', TIMESTAMPTZ '2025-10-08T03:15:00Z'),
    ('STU-2026-0002', 'FALL-2025', 5100, 'REC-2025-0002', TIMESTAMPTZ '2025-10-06T02:40:00Z'),
    ('STU-2026-0003', 'FALL-2025', 4850, 'REC-2025-0003', TIMESTAMPTZ '2025-10-10T06:05:00Z'),
    ('STU-2026-0004', 'FALL-2025', 4250, 'REC-2025-0004', TIMESTAMPTZ '2025-10-01T04:20:00Z'),
    ('STU-2026-0005', 'FALL-2025', 4500, 'REC-2025-0005', TIMESTAMPTZ '2025-10-09T07:10:00Z'),
    ('STU-2026-0006', 'FALL-2025', 4450, 'REC-2025-0006', TIMESTAMPTZ '2025-10-03T01:55:00Z'),
    ('STU-2026-0007', 'FALL-2025', 4700, 'REC-2025-0007', TIMESTAMPTZ '2025-10-11T05:30:00Z'),
    ('STU-2026-0008', 'FALL-2025', 4650, 'REC-2025-0008', TIMESTAMPTZ '2025-10-02T03:45:00Z'),
    ('STU-2026-0009', 'FALL-2025', 3750, 'REC-2025-0009', TIMESTAMPTZ '2025-10-07T02:25:00Z'),
    ('STU-2026-0010', 'FALL-2025', 4850, 'REC-2025-0010', TIMESTAMPTZ '2025-10-12T06:40:00Z'),
    ('STU-2026-0001', 'SPRING-2026', 4600, 'REC-2026-SPR-0001', TIMESTAMPTZ '2026-03-10T03:15:00Z'),
    ('STU-2026-0002', 'SPRING-2026', 5200, 'REC-2026-SPR-0002', TIMESTAMPTZ '2026-03-06T02:40:00Z'),
    ('STU-2026-0003', 'SPRING-2026', 4950, 'REC-2026-SPR-0003', TIMESTAMPTZ '2026-03-11T06:05:00Z'),
    ('STU-2026-0004', 'SPRING-2026', 4250, 'REC-2026-SPR-0004', TIMESTAMPTZ '2026-03-01T04:20:00Z'),
    ('STU-2026-0005', 'SPRING-2026', 4600, 'REC-2026-SPR-0005', TIMESTAMPTZ '2026-03-09T07:10:00Z'),
    ('STU-2026-0006', 'SPRING-2026', 4500, 'REC-2026-SPR-0006', TIMESTAMPTZ '2026-03-03T01:55:00Z'),
    ('STU-2026-0007', 'SPRING-2026', 4700, 'REC-2026-SPR-0007', TIMESTAMPTZ '2026-03-12T05:30:00Z'),
    ('STU-2026-0008', 'SPRING-2026', 4700, 'REC-2026-SPR-0008', TIMESTAMPTZ '2026-03-02T03:45:00Z'),
    ('STU-2026-0009', 'SPRING-2026', 3800, 'REC-2026-SPR-0009', TIMESTAMPTZ '2026-03-07T02:25:00Z'),
    ('STU-2026-0010', 'SPRING-2026', 4950, 'REC-2026-SPR-0010', TIMESTAMPTZ '2026-03-13T06:40:00Z')
)
INSERT INTO public.student_payments (account_id, amount, reference_number, receipt_status, paid_at)
SELECT account.id, source.amount, source.reference_number, 'completed', source.paid_at
FROM historical_payments AS source
JOIN public.profiles AS profile ON profile.student_number = source.student_number
JOIN public.academic_terms AS term ON term.code = source.term_code
JOIN public.student_accounts AS account ON account.student_id = profile.id AND account.term_id = term.id
ON CONFLICT (reference_number) DO UPDATE
SET account_id = EXCLUDED.account_id,
    amount = EXCLUDED.amount,
    receipt_status = EXCLUDED.receipt_status,
    paid_at = EXCLUDED.paid_at;
