export interface PasswordLink { tokenHash: string; type: 'invite' | 'recovery'; }

export function clearPasswordLink(link: PasswordLink | null) {
  if (link) link.tokenHash = '';
}

export function capturePasswordLink(): PasswordLink | null {
  const url = new URL(window.location.href);
  if (url.pathname !== '/set-password') return null;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const valid = tokenHash && /^[a-zA-Z0-9_-]{20,256}$/.test(tokenHash)
    && (type === 'invite' || type === 'recovery')
    && url.searchParams.getAll('token_hash').length === 1 && url.searchParams.getAll('type').length === 1;
  window.history.replaceState({}, document.title, '/set-password');
  return valid ? { tokenHash, type } : null;
}

