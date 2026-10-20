-- ============================================================
-- Frighton University SIS: seed.sql
-- Development and initial testing seed data
-- ============================================================

-- 1. Seed Academic Terms
INSERT INTO public.academic_terms (id, code, name, start_date, end_date, is_active)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'FALL-2026', 'Fall Semester 2026', '2026-09-01', '2026-12-20', true),
    ('a0000000-0000-0000-0000-000000000002', 'SPRING-2027', 'Spring Semester 2027', '2027-01-15', '2027-05-25', false)
ON CONFLICT (code) DO NOTHING;

-- 2. Seed Courses
INSERT INTO public.courses (id, course_code, title, description, credits, department)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'CS-101', 'Introduction to Computer Science', 'Foundations of algorithms, programming principles, and data structures.', 3, 'Computer Science'),
    ('c0000000-0000-0000-0000-000000000002', 'CS-220', 'Database Systems & Information Architecture', 'Relational database design, SQL querying, indexing, and normalization.', 4, 'Computer Science'),
    ('c0000000-0000-0000-0000-000000000003', 'HIST-105', 'Monsters & Folklore of Frighton Valley', 'Historical examination of regional legends, oral histories, and societal fears.', 3, 'Humanities'),
    ('c0000000-0000-0000-0000-000000000004', 'BIO-110', 'Cellular Anatomy & Physiology', 'Exploration of microscopic biology, cell reproduction, and biochemistry.', 4, 'Biological Sciences'),
    ('c0000000-0000-0000-0000-000000000005', 'MATH-180', 'Discrete Mathematics & Logic', 'Sets, functions, relations, propositional calculus, and proofs.', 3, 'Mathematics')
ON CONFLICT (course_code) DO NOTHING;

-- 3. Seed Course Sections
INSERT INTO public.course_sections (id, course_id, term_id, section_number, instructor_name, instructor_email, schedule, room)
VALUES
    ('s0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '01', 'Dr. Ada Lovelace', 'ada.lovelace@frighton.edu', 'Mon/Wed 09:00 - 10:30 AM', 'Turing Hall 101'),
    ('s0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '01', 'Dr. Alan Turing', 'alan.turing@frighton.edu', 'Tue/Thu 11:00 - 12:30 PM', 'Lovelace Lab 204'),
    ('s0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '01', 'Prof. Mina Harker', 'mina.harker@frighton.edu', 'Fri 13:00 - 16:00 PM', 'Grimoire Amphitheater')
ON CONFLICT (course_id, term_id, section_number) DO NOTHING;
