import { getSupabaseAdmin } from '../config/supabase.js';
import { assertSISLMSProject } from './projectGuard.js';

// These tables are owned by the SIS. The order follows their foreign-key graph
// from child to parent, so this reset never touches LMS-owned tables.
const SIS_TABLES_IN_DELETE_ORDER = [
  'academic_records',
  'student_holds',
  'student_payments',
  'student_accounts',
  'profiles',
  'course_sections',
  'courses',
  'academic_terms',
] as const;

function assertConfirmation(): void {
  if (!process.argv.includes('--confirm')) {
    throw new Error(
      'This permanently deletes SIS data. Re-run with: npm run reset:sis -- --confirm'
    );
  }
}

export async function resetSISData(): Promise<void> {
  assertConfirmation();
  assertSISLMSProject();
  const supabase = getSupabaseAdmin();
  const deletedCounts: Record<string, number> = {};

  for (const table of SIS_TABLES_IN_DELETE_ORDER) {
    // Every SIS table has a non-null UUID primary key. The predicate explicitly
    // targets all of its rows without broadening the reset to shared LMS tables.
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .not('id', 'is', null);

    if (error) throw new Error(`Failed to clear ${table}: ${error.message}`);
    deletedCounts[table] = count ?? 0;
  }

  console.log('SIS reset complete. Deleted rows:');
  for (const table of SIS_TABLES_IN_DELETE_ORDER) {
    console.log(`- ${table}: ${deletedCounts[table]}`);
  }
  console.log('Preserved LMS/shared tables: books, borrow_records, reservations, users, and Auth users.');
}

if (process.argv[1]?.endsWith('reset.ts') || process.argv[1]?.endsWith('reset.js')) {
  resetSISData().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
