-- ============================================================
-- Frighton University SIS: seed.sql
-- Development and initial testing seed data
-- ============================================================

-- 1. Seed Academic Terms
INSERT INTO public.academic_terms (code, name, start_date, end_date, is_active)
VALUES
    ('FALL-2026', 'Fall Semester 2026', '2026-09-01', '2026-12-20', true),
    ('SPRING-2027', 'Spring Semester 2027', '2027-01-15', '2027-05-25', false)
ON CONFLICT (code) DO NOTHING;

-- 2. Seed Courses
INSERT INTO public.courses (course_code, title, description, credits, department)
VALUES
    ('CS-101', 'Introduction to Computer Science', 'Foundations of algorithms, programming principles, and data structures.', 3, 'Computer Science'),
    ('CS-220', 'Database Systems & Information Architecture', 'Relational database design, SQL querying, indexing, and normalization.', 4, 'Computer Science'),
    ('HIST-105', 'Monsters & Folklore of Frighton Valley', 'Historical examination of regional legends, oral histories, and societal fears.', 3, 'Humanities'),
    ('BIO-110', 'Cellular Anatomy & Physiology', 'Exploration of microscopic biology, cell reproduction, and biochemistry.', 4, 'Biological Sciences'),
    ('MATH-180', 'Discrete Mathematics & Logic', 'Sets, functions, relations, propositional calculus, and proofs.', 3, 'Mathematics')
ON CONFLICT (course_code) DO NOTHING;

-- 3. Seed Course Sections
INSERT INTO public.course_sections (course_id, term_id, section_number, instructor_name, instructor_email, schedule, room)
VALUES
    (
        (SELECT id FROM public.courses WHERE course_code = 'CS-101'),
        (SELECT id FROM public.academic_terms WHERE code = 'FALL-2026'),
        '01', 'Dr. Ada Lovelace', 'ada.lovelace@frighton.edu', 'Mon/Wed 09:00 - 10:30 AM', 'Turing Hall 101'
    ),
    (
        (SELECT id FROM public.courses WHERE course_code = 'CS-220'),
        (SELECT id FROM public.academic_terms WHERE code = 'FALL-2026'),
        '01', 'Dr. Alan Turing', 'alan.turing@frighton.edu', 'Tue/Thu 11:00 - 12:30 PM', 'Lovelace Lab 204'
    ),
    (
        (SELECT id FROM public.courses WHERE course_code = 'HIST-105'),
        (SELECT id FROM public.academic_terms WHERE code = 'FALL-2026'),
        '01', 'Prof. Mina Harker', 'mina.harker@frighton.edu', 'Fri 13:00 - 16:00 PM', 'Grimoire Amphitheater'
    )
ON CONFLICT (course_id, term_id, section_number) DO NOTHING;
