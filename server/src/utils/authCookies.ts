import type { CookieOptions, Request, Response } from 'express';
import type { Session } from '@supabase/supabase-js';
import { config } from '../config/env.js';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'strict',
};
const refreshLifetime = 30 * 24 * 60 * 60 * 1000;

export function readCookie(req: Request, name: string): string | undefined {
  const value = req.headers.cookie?.split(';').find((part) => part.trim().startsWith(name + '='));
  if (!value) return undefined;
  try {
    return decodeURIComponent(value.trim().slice(name.length + 1));
  } catch {
    return undefined;
  }
}

export function readAccessToken(req: Request): string | undefined {
  if (req.headers.authorization) {
    return /^Bearer (\S+)$/i.exec(req.headers.authorization)?.[1];
  }
  return readCookie(req, 'sis_access');
}

export function setAuthCookies(res: Response, session: Session, remember: boolean): void {
  res.cookie('sis_access', session.access_token, {
    ...cookieOptions,
    path: '/api',
    ...(remember && { maxAge: session.expires_in * 1000 }),
  });
  const refreshOptions = {
    ...cookieOptions,
    path: '/api/auth',
    ...(remember && { maxAge: refreshLifetime }),
  };
  res.cookie('sis_refresh', session.refresh_token, refreshOptions);
  res.cookie('sis_remember', remember ? '1' : '0', refreshOptions);
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('sis_access', { ...cookieOptions, path: '/api' });
  res.clearCookie('sis_refresh', { ...cookieOptions, path: '/api/auth' });
  res.clearCookie('sis_remember', { ...cookieOptions, path: '/api/auth' });
}
