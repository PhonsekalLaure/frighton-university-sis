import type { CourseSeed } from './types.js';

export const courses: readonly CourseSeed[] = [
  { courseCode: 'CS-101', title: 'Introduction to Computer Science', description: 'Foundations of algorithms, programming principles, and data structures.', credits: 3, department: 'Computer Science' },
  { courseCode: 'CS-220', title: 'Database Systems & Information Architecture', description: 'Relational database design, SQL querying, indexing, and normalization.', credits: 4, department: 'Computer Science' },
  { courseCode: 'HIST-105', title: 'Monsters & Folklore of Frighton Valley', description: 'Historical examination of regional legends, oral histories, and societal fears.', credits: 3, department: 'Humanities' },
  { courseCode: 'BIO-110', title: 'Cellular Anatomy & Physiology', description: 'Exploration of microscopic biology, cell reproduction, and biochemistry.', credits: 4, department: 'Biological Sciences' },
  { courseCode: 'MATH-180', title: 'Discrete Mathematics & Logic', description: 'Sets, functions, relations, propositional calculus, and proofs.', credits: 3, department: 'Mathematics' },
];
