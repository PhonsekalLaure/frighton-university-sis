import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { assertSISLMSProject } from './projectGuard.js';

// These tables are owned by the SIS. The order follows their foreign-key graph
// from child to parent, so this reset never touches LMS-owned tables.
const SIS_TABLES_IN_DELETE_ORDER = [
  ['sis_library_debt_state', 'student_id'],
  ['academic_records', 'id'],
  ['student_holds', 'id'],
  ['student_payments', 'id'],
  ['student_accounts', 'id'],
  ['profiles', 'id'],
  ['course_sections', 'id'],
  ['courses', 'id'],
  ['academic_terms', 'id'],
] as const;

function assertConfirmation(): void {
  if (!process.argv.includes('--confirm')) {
    throw new Error(
      'This permanently deletes SIS data. Re-run with: npm run reset:sis -- --confirm'
    );
  }
}

export async function resetSISData(client?: SupabaseClient): Promise<void> {
  assertConfirmation();
  assertSISLMSProject();
  const supabase = client ?? getSupabaseAdmin();
  const deletedCounts: Record<string, number> = {};

  for (const [table, primaryKey] of SIS_TABLES_IN_DELETE_ORDER) {
    // Debt state uses student_id rather than id. Target each table's non-null
    // primary key without broadening the reset to shared LMS tables.
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .not(primaryKey, 'is', null);

    if (error) throw new Error(`Failed to clear ${table}: ${error.message}`);
    deletedCounts[table] = count ?? 0;
  }

  console.log('SIS reset complete. Deleted rows:');
  for (const [table] of SIS_TABLES_IN_DELETE_ORDER) {
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
