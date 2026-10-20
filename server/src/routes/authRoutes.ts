import { Router } from 'express';
import { createSupabaseAuthClient, getSupabaseAdmin } from '../config/supabase.js';
import { createAuthRateLimit, requireAuth } from '../middlewares/auth.js';
import { AuthError, findUser } from '../services/authService.js';
import { clearAuthCookies, readAccessToken, readCookie, setAuthCookies } from '../utils/authCookies.js';

export const authRouter = Router();

authRouter.post('/login', createAuthRateLimit(20, 15 * 60 * 1000), async (req, res, next) => {
  try {
    const { email, password, remember = false } = req.body ?? {};
    if (
      typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || !password || password.length > 1024 ||
      typeof remember !== 'boolean'
    ) {
      throw new AuthError(400, 'Enter a valid student/admin email and password.');
    }

    const client = createSupabaseAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.session || !data.user) {
      if (error && (!error.status || error.status >= 500)) {
        throw new AuthError(503, 'Authentication is temporarily unavailable. Please try again.');
      }
      throw new AuthError(401, 'Invalid email or password.');
    }

    try {
      const user = await findUser(data.user);
      setAuthCookies(res, data.session, remember);
      res.json({ user });
    } catch (error) {
      await client.auth.signOut({ scope: 'local' });
      clearAuthCookies(res);
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, (_req, res) => {
  res.json({ user: res.locals.user });
});

authRouter.post('/refresh', createAuthRateLimit(60, 15 * 60 * 1000), async (req, res, next) => {
  try {
    const refreshToken = readCookie(req, 'sis_refresh');
    if (!refreshToken) {
      throw new AuthError(401, 'Please sign in to access your account.');
    }
    const client = createSupabaseAuthClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) {
      if (error && (!error.status || error.status >= 500)) {
        throw new AuthError(503, 'Authentication is temporarily unavailable. Please try again.');
      }
      throw new AuthError(401, 'Your session has expired. Please sign in again.');
    }

    try {
      const user = await findUser(data.user);
      setAuthCookies(res, data.session, readCookie(req, 'sis_remember') === '1');
      res.json({ user });
    } catch (error) {
      await client.auth.signOut({ scope: 'local' });
      throw error;
    }
  } catch (error) {
    if (error instanceof AuthError && [401, 403].includes(error.status)) clearAuthCookies(res);
    next(error);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  clearAuthCookies(res);
  try {
    let token = readAccessToken(req);
    // An expired access cookie may already be absent when signing out
    if (!token) {
      const refreshToken = readCookie(req, 'sis_refresh');
      if (refreshToken) {
        const { data } = await createSupabaseAuthClient().auth.refreshSession({ refresh_token: refreshToken });
        token = data.session?.access_token;
      }
    }
    if (token) {
      const { error } = await getSupabaseAdmin().auth.admin.signOut(token, 'local');
      if (error && (!error.status || error.status >= 500)) {
        throw new AuthError(503, 'Your browser session was cleared, but sign out could not reach the authentication service.');
      }
    }
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});
