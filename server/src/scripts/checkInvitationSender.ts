import { config } from '../config/env.js';
import { getAdminPortalClient } from '../config/supabase.js';
import { assertLinkedAdminProject } from './adminProjectGuard.js';

// No SMTP connection, email, link generation, or Auth-setting mutation.
const checks: Record<string, boolean> = {
  passwordPageURL: false,
  databaseMigration: false,
};
try {
  const url = new URL('/set-password', config.clientUrl);
  checks.passwordPageURL = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
    (config.nodeEnv !== 'production' || url.protocol === 'https:');
} catch { /* Invalid URLs are reported as a failed check without printing configuration. */ }
try {
  assertLinkedAdminProject();
  const { data, error } = await getAdminPortalClient().rpc('sis_invitation_delivery_ready');
  checks.databaseMigration = !error && data === true;
} catch { /* Never print raw provider errors or credentials. */ }
console.log(JSON.stringify({ checks, emailSender: 'Uses existing Supabase Auth SMTP configuration.',
  invitationTemplate: 'Verify the SIS password-page template before mailbox testing.',
  inboxDelivery: 'Not tested; requires an authorized mailbox test.' }, null, 2));
if (Object.values(checks).some(value => !value)) process.exitCode = 1;
