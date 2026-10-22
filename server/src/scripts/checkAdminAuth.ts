import { config } from '../config/env.js';
import { adminAuthReadiness, buildSISPasswordTemplate } from '../services/adminEmailTemplates.js';
import { assertLinkedAdminProject, SIS_PROJECT_REF } from './adminProjectGuard.js';

try {
  assertLinkedAdminProject();
  const args = process.argv.slice(2);
  const redirect = new URL('/set-password', config.clientUrl).toString();
  if (args.length === 1 && args[0] === '--template-drafts') {
    // Deliberate placeholder: an operator must preserve the complete current template body.
    console.log(JSON.stringify({ activation: 'Blocked until the frontend password page is deployed and smoke-tested',
      invite: buildSISPasswordTemplate('__EXISTING_INVITE_TEMPLATE_BODY__', redirect, 'invite'),
      recovery: buildSISPasswordTemplate('__EXISTING_RECOVERY_TEMPLATE_BODY__', redirect, 'recovery') }, null, 2));
  } else {
    if (args.length) throw new Error('Usage: admin:auth-check [--template-drafts]');
    // A service-role key cannot inspect Auth project settings. Never scrape stored CLI credentials.
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) {
      console.log(JSON.stringify({ project: SIS_PROJECT_REF, redirect, remoteAuthSettings: 'unverified',
        reason: 'No Management API access token supplied. Verify Auth settings in the Supabase dashboard.' }, null, 2));
      process.exitCode = 2;
    } else {
      const response = await fetch(`https://api.supabase.com/v1/projects/${SIS_PROJECT_REF}/config/auth`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Auth configuration is unverified: Management API access failed.');
      const checks = adminAuthReadiness(await response.json(), redirect);
      console.log(JSON.stringify({ project: SIS_PROJECT_REF, redirect, checks,
        delivery: 'unverified until an approved mailbox smoke test',
        frontendDeployment: 'manual deployment gate; this command does not activate templates' }, null, 2));
      if (Object.values(checks).some(value => !value)) process.exitCode = 1;
    }
  }
} catch {
  console.error('Auth readiness unverified. Check the SIS project link, configuration, and Management API access. No settings were changed.');
  process.exitCode = 2;
}
