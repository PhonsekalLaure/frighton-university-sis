/** Compose against the current project body at deployment; never discard the LMS fallback. */
export function buildSISPasswordTemplate(existingBody: string, redirect: string, type: 'invite' | 'recovery'): string {
  const url = new URL(redirect);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/set-password' || url.search || url.hash ||
    url.username || url.password || /["{}\r\n]/.test(redirect)) throw new Error('Invalid SIS password redirect.');
  return `{{ if eq .RedirectTo "${redirect}" }}<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=${type}">Set your university password</a></p>{{ else }}${existingBody}{{ end }}`;
}

export function adminAuthReadiness(settings: Record<string, unknown>, redirect: string) {
  const redirects = typeof settings.uri_allow_list === 'string' ? settings.uri_allow_list.split(',').map(x => x.trim()) : [];
  const minimum = Number(settings.password_min_length);
  const otpExpiry = Number(settings.mailer_otp_exp);
  return {
    exactRedirectAllowed: redirects.includes(redirect),
    customSMTPConfigured: Boolean(settings.smtp_host && settings.smtp_admin_email && settings.smtp_user),
    passwordPolicyCompatible: Number.isInteger(minimum) && minimum > 0 && minimum <= 128,
    linkExpiryConfigured: Number.isFinite(otpExpiry) && otpExpiry > 0,
    inviteTemplateStaged: typeof settings.mailer_templates_invite_content === 'string' &&
      settings.mailer_templates_invite_content.includes(`{{ if eq .RedirectTo "${redirect}" }}`) &&
      settings.mailer_templates_invite_content.includes('token_hash={{ .TokenHash }}&amp;type=invite'),
    recoveryTemplateStaged: typeof settings.mailer_templates_recovery_content === 'string' &&
      settings.mailer_templates_recovery_content.includes(`{{ if eq .RedirectTo "${redirect}" }}`) &&
      settings.mailer_templates_recovery_content.includes('token_hash={{ .TokenHash }}&amp;type=recovery'),
  };
}
