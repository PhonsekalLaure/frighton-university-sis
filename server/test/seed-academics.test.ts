import assert from 'node:assert/strict';
import { test } from 'node:test';
import { academicRecords } from '../src/seed-data/academicRecords.js';
import { courses } from '../src/seed-data/courses.js';
import { payments } from '../src/seed-data/payments.js';
import { sections } from '../src/seed-data/sections.js';
import { studentAccounts } from '../src/seed-data/studentAccounts.js';
import { students } from '../src/seed-data/students.js';
import { terms } from '../src/seed-data/terms.js';
import { getSchedule } from '../src/services/scheduleService.js';

const sectionKey = (row: { termCode: string; courseCode: string; sectionNumber: string }) =>
  `${row.termCode}/${row.courseCode}/${row.sectionNumber}`;
const courseByCode = new Map(courses.map(course => [course.courseCode, course]));
const sectionByKey = new Map(sections.map(section => [sectionKey(section), section]));
const termByCode = new Map(terms.map(term => [term.code, term]));

function meetings(schedule: string) {
  return schedule.split(';').flatMap(part => {
    const match = /^\s*((?:Mon|Tue|Wed|Thu|Fri)(?:\/(?:Mon|Tue|Wed|Thu|Fri))*) (\d{2}):(\d{2}) - (\d{2}):(\d{2})\s*$/.exec(part);
    assert(match, `Unambiguous published meeting required: ${schedule}`);
    const start = Number(match[2]) * 60 + Number(match[3]);
    const end = Number(match[4]) * 60 + Number(match[5]);
    assert(start >= 8 * 60 && end <= 18 * 60 && end > start, `Invalid teaching hours: ${schedule}`);
    return match[1].split('/').map(day => ({ day, start, end }));
  });
}

test('seeded timetables have valid contact hours and no instructor or room clashes', () => {
  assert.equal(sectionByKey.size, sections.length, 'Sections must be unique');
  assert.equal(courseByCode.size, courses.length, 'Subject codes must be unique');
  const occupied: Array<{ term: string; teacher: string; room: string; key: string; day: string; start: number; end: number }> = [];
  for (const section of sections) {
    const subject = courseByCode.get(section.courseCode);
    assert(subject && termByCode.has(section.termCode));
    const slots = meetings(section.schedule);
    const contactHours = slots.reduce((total, slot) => total + (slot.end - slot.start) / 60, 0);
    assert.equal(contactHours, subject.units === 4 ? 6 : subject.units, `${sectionKey(section)}: lecture/lab contact hours`);
    assert(section.sectionNumber.length <= 10 && section.schedule.length <= 100, 'Published fields must fit the schema');
    for (const slot of slots) {
      for (const prior of occupied) {
        if (prior.term !== section.termCode || prior.day !== slot.day || prior.end <= slot.start || slot.end <= prior.start) continue;
        assert.notEqual(prior.teacher, section.instructorEmail, `Instructor double-booked: ${prior.key} / ${sectionKey(section)}`);
        assert.notEqual(prior.room, section.room, `Room double-booked: ${prior.key} / ${sectionKey(section)}`);
      }
      occupied.push({ term: section.termCode, teacher: section.instructorEmail, room: section.room, key: sectionKey(section), ...slot });
    }
  }
});

test('every student has a realistic weekly load and term-specific transcript without timetable clashes', () => {
  assert.equal(terms.filter(term => term.isActive).length, 1);
  assert(terms.every(term => /^(First|Second) Term, AY \d{4}–\d{4}$/.test(term.name)));
  const uniqueRecords = new Set<string>();
  for (const student of students) {
    const records = academicRecords.filter(record => record.studentNumber === student.studentNumber);
    const current = records.filter(record => record.isCurrent);
    assert.equal(current.length, 6, `${student.studentNumber}: six current subjects`);
    assert.equal(new Set(records.map(record => record.termCode)).size, student.yearLevel === 1 ? 1 : 3);
    for (const failed of records.filter(record => record.grade === 'F')) {
      assert(current.some(record => record.courseCode === failed.courseCode), 'Failed historical subjects are retaken in the fixture schedule');
    }
    const days = new Map<string, number>();
    for (const term of terms) {
      const termRecords = records.filter(record => record.termCode === term.code);
      if (!termRecords.length) continue;
      assert.equal(termRecords.length, 6, `${student.studentNumber}/${term.code}: complete teaching load`);
      const units = termRecords.reduce((total, record) => total + courseByCode.get(record.courseCode)!.units, 0);
      assert(units >= 17 && units <= 21, `Unrealistic unit load for ${student.studentNumber}/${term.code}`);
      const occupied: ReturnType<typeof meetings> = [];
      for (const record of termRecords) {
        const key = `${record.studentNumber}/${sectionKey(record)}`;
        assert(!uniqueRecords.has(key), `Duplicate academic assignment: ${key}`);
        uniqueRecords.add(key);
        const section = sectionByKey.get(sectionKey(record));
        assert(section, `Missing teaching section: ${key}`);
        assert.equal(record.isCurrent, term.isActive, 'Current assignments belong only to the active term');
        assert.equal(record.grade === 'IP', term.isActive, 'Only completed terms contribute final grades');
        for (const slot of meetings(section.schedule)) {
          assert(!occupied.some(other => other.day === slot.day && other.start < slot.end && slot.start < other.end), `Student double-booked: ${key}`);
          occupied.push(slot);
          if (record.isCurrent) days.set(slot.day, (days.get(slot.day) ?? 0) + 1);
        }
      }
    }
    assert.equal(days.size, 5, `${student.studentNumber}: classes across the working week`);
    assert([...days.values()].filter(count => count >= 2).length >= 4, `${student.studentNumber}: multiple classes on multiple days`);
    assert(records.filter(record => record.isCurrent).some(record =>
      courseByCode.get(record.courseCode)?.department === student.department), 'Current load includes department subjects');
  }
  assert.equal(uniqueRecords.size, academicRecords.length, 'Every academic record belongs to a known student');
});

test('billing fixture term references stay aligned with each student academic history', () => {
  for (const statement of studentAccounts) {
    assert(academicRecords.some(record => record.studentNumber === statement.studentNumber && record.termCode === statement.termCode));
  }
  for (const receipt of payments) {
    assert(studentAccounts.some(account => account.studentNumber === receipt.studentNumber && account.termCode === receipt.termCode));
  }
});

test('published classes are ordered by weekday and start time with unannounced meetings last', async () => {
  const schedules = [null, 'Fri 08:00 - 11:00', 'Tue/Thu 09:45 - 11:15',
    'Mon/Wed 13:00 - 14:30', 'Mon/Wed 08:00 - 09:30; Fri 13:00 - 16:00', 'Monday 9:45 AM - 11:15 AM'];
  const records = schedules.map((schedule, index) => ({ id: String(index), section: { term_id: 'current', schedule,
    section_number: '01', course: { course_code: `SUB-${index}`, title: 'Subject', credits: 3 } } }));
  const client = { from(table: string) {
    const q: any = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: { id: table === 'profiles' ? 'student' : 'current' }, error: null }),
      then: (resolve: any) => Promise.resolve({ data: records, error: null }).then(resolve) };
    return q;
  } };
  const result = await getSchedule('student', client);
  assert.deepEqual(result.classes.map(subject => subject.id), ['4', '5', '3', '2', '1', '0']);
});
