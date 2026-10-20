import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { findUser, AuthError } from '../src/services/authService.js';
import { readAccessToken, readCookie, setAuthCookies, clearAuthCookies } from '../src/utils/authCookies.js';
import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('SIS Backend Foundation & Security Verification', () => {
  const app = createApp();
  let server: http.Server;
  let baseUrl: string;

  test('Server setup & startup', async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });
    assert.ok(baseUrl, 'Server should have a valid local address');
  });

  test('1. Health check returns 200 and expected payload', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.service, 'Frighton University Student Information System (SIS) API');
    assert.equal(typeof data.timestamp, 'string');
  });

  test('2. Security headers are applied to responses', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  test('3. Origin protection blocks unauthorized browser origins on POST', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Origin': 'http://malicious-website.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'test@frighton.edu', password: 'password123' }),
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'Request origin is not allowed.');
  });

  test('4. Login validates invalid/missing email and password', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'invalid-email', password: '' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'Enter a valid student/admin email and password.');
  });

  test('5. LMS Integration API route is accessible with valid API key even without Origin header', async () => {
    const res = await fetch(`${baseUrl}/api/v1/integration/students/NON_EXISTENT_ID/status`, {
      method: 'GET',
      headers: {
        'x-lms-api-key': 'frighton-lms-sis-shared-secret-key-change-in-prod',
      },
    });
    // Reaches DB handler (not blocked by origin check)
    assert.notEqual(res.status, 403, 'Should not be blocked by origin protection');
  });

  test('6. Integration API route rejects invalid API key', async () => {
    const res = await fetch(`${baseUrl}/api/v1/integration/students/STU-2026-0001/status`, {
      method: 'GET',
      headers: {
        'x-lms-api-key': 'wrong-key',
      },
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Unauthorized: Invalid or missing integration API key');
  });

  test('7. Cookie utilities correctly set and parse cookies and bearer tokens', () => {
    const reqWithBearer = {
      headers: { authorization: 'Bearer test-jwt-token' },
    } as unknown as Request;
    assert.equal(readAccessToken(reqWithBearer), 'test-jwt-token');

    const reqWithCookie = {
      headers: { cookie: 'other=123; sis_access=cookie-token-abc; foo=bar' },
    } as unknown as Request;
    assert.equal(readAccessToken(reqWithCookie), 'cookie-token-abc');
    assert.equal(readCookie(reqWithCookie, 'sis_access'), 'cookie-token-abc');
    assert.equal(readCookie(reqWithCookie, 'non_existent'), undefined);

    const cookiesSet: Record<string, { val: string; options: any }> = {};
    const mockRes = {
      cookie: (name: string, val: string, options: any) => {
        cookiesSet[name] = { val, options };
      },
      clearCookie: (name: string) => {
        delete cookiesSet[name];
      },
    } as unknown as Response;

    setAuthCookies(mockRes, { access_token: 'acc-123', refresh_token: 'ref-456', expires_in: 3600 } as any, true);
    assert.equal(cookiesSet['sis_access'].val, 'acc-123');
    assert.equal(cookiesSet['sis_refresh'].val, 'ref-456');
    assert.equal(cookiesSet['sis_remember'].val, '1');

    clearAuthCookies(mockRes);
    assert.equal(Object.keys(cookiesSet).length, 0);
  });

  test('8. Role Restriction in findUser: only students and admins are allowed', async () => {
    let mockProfile: any = null;

    const mockAdminClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mockProfile, error: null }),
          }),
          ilike: () => ({
            maybeSingle: async () => ({ data: mockProfile, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const mockUser = { id: 'user-1', email: 'user@frighton.edu' } as any;

    // Scenario A: Student role -> Allowed
    mockProfile = {
      id: 'user-1',
      frighton_id: 'STU-2026-0001',
      first_name: 'John',
      last_name: 'Doe',
      email: 'user@frighton.edu',
      role: 'student',
      academic_status: 'active',
    };
    const studentUser = await findUser(mockUser, mockAdminClient);
    assert.equal(studentUser.role, 'student');
    assert.equal(studentUser.frightonId, 'STU-2026-0001');

    // Scenario B: Admin role -> Allowed
    mockProfile = {
      id: 'user-1',
      frighton_id: 'ADM-2026-0001',
      first_name: 'Alice',
      last_name: 'Admin',
      email: 'admin@frighton.edu',
      role: 'admin',
      academic_status: 'active',
    };
    const adminUser = await findUser(mockUser, mockAdminClient);
    assert.equal(adminUser.role, 'admin');

    // Scenario C: Instructor role -> Rejected (403)
    mockProfile = {
      id: 'user-1',
      frighton_id: 'FAC-2026-0001',
      first_name: 'Prof',
      last_name: 'Severus',
      email: 'prof@frighton.edu',
      role: 'instructor',
      academic_status: 'active',
    };
    await assert.rejects(
      async () => await findUser(mockUser, mockAdminClient),
      (err: any) => err instanceof AuthError && err.status === 403 && err.message.includes('restricted to students and administrators')
    );

    // Scenario D: Registrar role -> Rejected (403)
    mockProfile.role = 'registrar';
    await assert.rejects(
      async () => await findUser(mockUser, mockAdminClient),
      (err: any) => err instanceof AuthError && err.status === 403 && err.message.includes('restricted to students and administrators')
    );

    // Scenario E: Suspended Student -> Rejected (403)
    mockProfile = {
      id: 'user-1',
      frighton_id: 'STU-2026-0002',
      first_name: 'Suspended',
      last_name: 'Student',
      email: 'suspended@frighton.edu',
      role: 'student',
      academic_status: 'suspended',
    };
    await assert.rejects(
      async () => await findUser(mockUser, mockAdminClient),
      (err: any) => err instanceof AuthError && err.status === 403 && err.message.includes('suspended')
    );

    // Scenario F: Profile Not Found -> Rejected (404)
    mockProfile = null;
    await assert.rejects(
      async () => await findUser(mockUser, mockAdminClient),
      (err: any) => err instanceof AuthError && err.status === 404
    );
  });

  test('Teardown server', async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
