-- Static transcript history for the SIS demo. Final grades remain a read-only
-- academic-record snapshot; current Fall 2026 assignments use IP.
INSERT INTO public.academic_terms (code, name, start_date, end_date, is_active)
VALUES
  ('FALL-2025', 'Fall Semester 2025', DATE '2025-09-01', DATE '2025-12-20', FALSE),
  ('SPRING-2026', 'Spring Semester 2026', DATE '2026-01-15', DATE '2026-05-25', FALSE)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    is_active = EXCLUDED.is_active;

-- Reuse published Fall 2026 course metadata for historical transcript
-- sections. Transcript data does not expose registration or capacity state.
INSERT INTO public.course_sections (
  course_id, term_id, section_number, instructor_name, instructor_email, schedule, room
)
SELECT current_section.course_id, historical_term.id, current_section.section_number,
  current_section.instructor_name, current_section.instructor_email,
  current_section.schedule, current_section.room
FROM public.course_sections AS current_section
JOIN public.academic_terms AS current_term ON current_term.id = current_section.term_id
CROSS JOIN public.academic_terms AS historical_term
WHERE current_term.code = 'FALL-2026'
  AND historical_term.code IN ('FALL-2025', 'SPRING-2026')
ON CONFLICT (course_id, term_id, section_number) DO NOTHING;

-- Move records already marked non-current out of the active term, preserving
-- their existing final grade and transcript record ID.
WITH legacy_history (student_number, course_code, term_code) AS (
  VALUES
    ('STU-2026-0002', 'HIST-105', 'FALL-2025'),
    ('STU-2026-0003', 'CS-220', 'FALL-2025'),
    ('STU-2026-0004', 'CS-101', 'FALL-2025'),
    ('STU-2026-0005', 'HIST-105', 'FALL-2025'),
    ('STU-2026-0008', 'CS-101', 'FALL-2025')
)
UPDATE public.academic_records AS record
SET section_id = target_section.id,
    is_current = FALSE,
    updated_at = timezone('utc'::text, now())
FROM legacy_history
JOIN public.profiles AS profile ON profile.student_number = legacy_history.student_number
JOIN public.courses AS course ON course.course_code = legacy_history.course_code
JOIN public.academic_terms AS target_term ON target_term.code = legacy_history.term_code
JOIN public.course_sections AS target_section
  ON target_section.course_id = course.id
  AND target_section.term_id = target_term.id
  AND target_section.section_number = '01'
JOIN public.academic_terms AS active_term ON active_term.code = 'FALL-2026'
JOIN public.course_sections AS active_section
  ON active_section.course_id = course.id
  AND active_section.term_id = active_term.id
  AND active_section.section_number = '01'
WHERE record.student_id = profile.id
  AND record.section_id = active_section.id
  AND record.is_current = FALSE;

-- Snapshot final grades that had been placed on current Fall 2026 assignments,
-- then reset the active assignments to IP. The unique student/section key
-- makes this safe to re-run while preserving static transcript history.
WITH current_finals (student_number, course_code, grade, term_code) AS (
  VALUES
    ('STU-2026-0004', 'CS-220', 'A-', 'SPRING-2026'),
    ('STU-2026-0006', 'CS-220', 'B+', 'SPRING-2026'),
    ('STU-2026-0007', 'HIST-105', 'A-', 'SPRING-2026'),
    ('STU-2026-0008', 'CS-220', 'A', 'SPRING-2026'),
    ('STU-2026-0009', 'CS-101', 'A', 'SPRING-2026'),
    ('STU-2026-0010', 'CS-220', 'B', 'SPRING-2026')
)
INSERT INTO public.academic_records (student_id, section_id, grade, is_current)
SELECT profile.id, target_section.id, current_finals.grade, FALSE
FROM current_finals
JOIN public.profiles AS profile ON profile.student_number = current_finals.student_number
JOIN public.courses AS course ON course.course_code = current_finals.course_code
JOIN public.academic_terms AS target_term ON target_term.code = current_finals.term_code
JOIN public.course_sections AS target_section
  ON target_section.course_id = course.id
  AND target_section.term_id = target_term.id
  AND target_section.section_number = '01'
ON CONFLICT (student_id, section_id) DO UPDATE
SET grade = EXCLUDED.grade,
    is_current = FALSE,
    updated_at = timezone('utc'::text, now());

WITH current_finals (student_number, course_code) AS (
  VALUES
    ('STU-2026-0004', 'CS-220'),
    ('STU-2026-0006', 'CS-220'),
    ('STU-2026-0007', 'HIST-105'),
    ('STU-2026-0008', 'CS-220'),
    ('STU-2026-0009', 'CS-101'),
    ('STU-2026-0010', 'CS-220')
)
UPDATE public.academic_records AS record
SET grade = 'IP',
    is_current = TRUE,
    updated_at = timezone('utc'::text, now())
FROM current_finals
JOIN public.profiles AS profile ON profile.student_number = current_finals.student_number
JOIN public.courses AS course ON course.course_code = current_finals.course_code
JOIN public.academic_terms AS active_term ON active_term.code = 'FALL-2026'
JOIN public.course_sections AS active_section
  ON active_section.course_id = course.id
  AND active_section.term_id = active_term.id
  AND active_section.section_number = '01'
WHERE record.student_id = profile.id
  AND record.section_id = active_section.id;
