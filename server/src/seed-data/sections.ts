import { courses } from './courses.js';
import { curricula } from './curricula.js';
import type { SectionSeed } from './types.js';

const faculty: Record<string, readonly string[]> = {
  'Biological Sciences': ['Elena Cruz', 'Rafael Mendoza', 'Isabel Reyes', 'Marco Santos', 'Beatriz Lim', 'Andres Flores'],
  'Computer Science': ['Miguel Garcia', 'Patricia Tan', 'Paolo Ramos', 'Camille Navarro', 'Lorenzo Dizon', 'Angela Uy'],
  Humanities: ['Sofia Villanueva', 'Gabriel Castillo', 'Lucia Mercado', 'Daniel Aquino', 'Mariana Torres', 'Emilio Pascual'],
  Mathematics: ['Teresa Bautista', 'Nicolas Valdez', 'Carmen Salazar', 'Luis Fernandez', 'Diana Santiago', 'Antonio Rivera'],
};
const meetings = [
  'Mon/Wed 08:00 - 09:30', 'Mon/Wed 09:45 - 11:15',
  'Tue/Thu 08:00 - 09:30', 'Tue/Thu 09:45 - 11:15',
  'Mon/Wed 13:00 - 14:30', 'Fri 08:00 - 11:00',
];
const laboratories = ['Fri 13:00 - 16:00', 'Thu 14:45 - 17:45', 'Wed 14:45 - 17:45', 'Tue 14:45 - 17:45'];
const courseByCode = new Map(courses.map(course => [course.courseCode, course]));

export const sections: readonly SectionSeed[] = curricula.flatMap(curriculum => {
  const plans = [
    ...(curriculum.previous ? [
      { termCode: 'AY2025-2026-T1', subjects: curriculum.previous[0] },
      { termCode: 'AY2025-2026-T2', subjects: curriculum.previous[1] },
    ] : []),
    { termCode: 'AY2026-2027-T1', subjects: curriculum.current },
  ];
  return plans.flatMap(({ termCode, subjects }) => subjects.map((courseCode, index) => {
    const course = courseByCode.get(courseCode);
    if (!course) throw new Error(`Unknown seed subject ${courseCode}.`);
    const instructor = faculty[curriculum.department][(index + curriculum.facultyOffset) % 6];
    const schedule = course.units === 2 ? 'Fri 08:00 - 10:00'
      : course.units === 4 ? `${meetings[index]}; ${laboratories[index]}` : meetings[index];
    return { courseCode, termCode, sectionNumber: `${curriculum.key}-01`,
      instructorName: `Prof. ${instructor}`, instructorEmail: `${instructor.toLowerCase().replaceAll(' ', '.')}@frighton.edu`,
      schedule, room: course.units === 4 ? `${curriculum.room} Laboratory` : curriculum.room };
  }));
});
