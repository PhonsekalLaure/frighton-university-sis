import { getAdminPortalClient } from '../config/supabase.js';
import { uuid } from '../services/adminValidation.js';
import { assertLinkedAdminProject } from './adminProjectGuard.js';

try {
  assertLinkedAdminProject();
  const [flag, id, ...extra] = process.argv.slice(2);
  if (!['--student', '--operation'].includes(flag) || extra.length) {
    throw new Error('Usage: admin:diagnose -- --student <uuid> OR --operation <uuid>');
  }
  uuid(id, 'identifier');
  const { data, error } = await getAdminPortalClient().rpc('sis_account_diagnostics', {
    p_student_id: flag === '--student' ? id : null, p_operation_id: flag === '--operation' ? id : null,
  });
  if (error) throw new Error('Read-only account diagnostics unavailable. Check project access and installed migrations.');
  console.log(JSON.stringify(data, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Read-only diagnostics failed.');
  process.exitCode = 1;
}
