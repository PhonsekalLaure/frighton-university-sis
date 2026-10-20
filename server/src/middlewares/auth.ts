import type { Request, RequestHandler } from 'express';
import { config } from '../config/env.js';
import { AuthError, SISUser, verifyUser } from '../services/authService.js';
import { clearAuthCookies, readAccessToken } from '../utils/authCookies.js';

export interface AuthenticatedUser extends SISUser {}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const requireAuth: RequestHandler = async (req: AuthenticatedRequest, res, next) => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ error: 'Please sign in to access your account.' });
    return;
  }

  try {
    const user = await verifyUser(token);
    res.locals.user = user;
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) clearAuthCookies(res);
    next(error);
  }
};

export const protectCookieRequests: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get('origin');
  const serverBearerRequest = !origin && /^Bearer \S+$/i.test(req.get('authorization') || '');
  const serverApiKeyRequest = !origin && Boolean(req.get('x-lms-api-key') || req.get('x-api-key'));
  const isIntegrationRoute = req.baseUrl?.startsWith('/api/v1/integration') || req.path?.startsWith('/api/v1/integration') || req.originalUrl?.startsWith('/api/v1/integration');

  if (origin !== config.clientUrl && !serverBearerRequest && !serverApiKeyRequest && !isIntegrationRoute) {
    res.status(403).json({ error: 'Request origin is not allowed.' });
    return;
  }
  next();
};

// Per-process limit. Multiple API replicas must share a limit at the reverse proxy.
export function createAuthRateLimit(limit: number, windowMs: number): RequestHandler {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    let entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      if (attempts.size >= 10000) {
        for (const [ip, value] of attempts) {
          if (value.resetAt <= now) attempts.delete(ip);
        }
        if (attempts.size >= 10000 && !attempts.has(key)) {
          res.status(503).json({ error: 'Sign in is busy. Please try again later.' });
          return;
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      attempts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' });
      return;
    }
    next();
  };
}

export function requireRole(allowedRoles: ('student' | 'admin')[]): RequestHandler {
  return (req: AuthenticatedRequest, res, next) => {
    const user = (res.locals.user || req.user) as AuthenticatedUser | undefined;
    if (!user) {
      res.status(401).json({ error: 'Please sign in to access this resource.' });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({
        error: `Forbidden: Access requires one of the following roles: [${allowedRoles.join(', ')}]`,
      });
      return;
    }
    next();
  };
}

export const requireAdmin: RequestHandler = (req, res, next) => requireRole(['admin'])(req, res, next);
export const requireStudent: RequestHandler = (req, res, next) => requireRole(['student'])(req, res, next);
export const requireStudentOrAdmin: RequestHandler = (req, res, next) => requireRole(['student', 'admin'])(req, res, next);
