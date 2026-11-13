import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { StudentPhotoService, photoExtension, studentPhotoLimit } from '../src/services/studentPhotoService.js';
import { createAdminRouter } from '../src/routes/adminRoutes.js';
import { protectCookieRequests } from '../src/middlewares/auth.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { config } from '../src/config/env.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6GQAAAABJRU5ErkJggg==', 'base64');

test('photo validation rejects unsupported, oversized, empty and falsely labeled files', () => {
  assert.equal(photoExtension(png, 'image/png'), 'png');
  assert.equal(photoExtension(Buffer.from([255,216,255,224]), 'image/jpeg'), 'jpg');
  assert.equal(photoExtension(Buffer.from('RIFF1234WEBP1234'), 'image/webp'), 'webp');
  for (const [body, type] of [[png, 'image/jpeg'], [Buffer.from('<script>'), 'image/png'],
    [Buffer.alloc(studentPhotoLimit + 1), 'image/png'], [Buffer.alloc(0), 'image/png'], [undefined, 'image/png'],
    [Buffer.from('<svg/>'), 'image/svg+xml']] as const) assert.throws(() => photoExtension(body, type));
});

test('storage paths reuse identical uploads and storage errors do not expose provider details', async () => {
  const paths: string[] = [];
  let error: any = null;
  const service = new StudentPhotoService({ storage: { from: (bucket: string) => {
    assert.equal(bucket, 'sis-student-photos');
    return {
      upload: async (path: string, body: Buffer, options: any) => {
        paths.push(path); assert.deepEqual(body, png); assert.equal(options.upsert, false);
        assert.equal(options.contentType, 'image/png'); return { error };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
    };
  } } } as any);
  const first = await service.upload('admin-id', png, 'image/png');
  for (const duplicate of [{ statusCode: '409' }, { statusCode: '400', message: 'The resource already exists' },
    { statusCode: 400, message: 'Asset Already Exists' }, { statusCode: 400, code: 'Duplicate' }]) {
    error = duplicate;
    assert.deepEqual(await service.upload('admin-id', png, 'image/png'), first);
  }
  assert.equal(paths[0], paths[1]);
  assert.match(paths[0], /^admin-id\/[0-9a-f]{64}\.png$/);
  error = { statusCode: '400', message: 'Invalid MIME type' };
  await assert.rejects(() => service.upload('admin-id', png, 'image/png'), (e: any) => e.status === 503);
  error = { statusCode: '500', message: 'PRIVATE_PROVIDER_DETAIL' };
  await assert.rejects(() => service.upload('admin-id', png, 'image/png'), (e: any) => e.status === 503 && !e.message.includes('PRIVATE'));
});

test('photo HTTP uploads require an admin and trusted origin before parsing bounded image bodies', async () => {
  let uploads = 0;
  const photos = { upload: async (_actor: string, body: Buffer, type: string) => {
    uploads++; photoExtension(body, type); return { avatarUrl: 'https://storage.test/photo.png' };
  } } as StudentPhotoService;
  const app = express().use(protectCookieRequests, express.json({ limit: '10kb' }));
  app.use('/api/v1/admin', createAdminRouter(undefined, (req, res, next) => {
    if (!req.get('x-test-role')) { res.sendStatus(401); return; }
    res.locals.user = { id: 'admin-id', role: req.get('x-test-role') }; next();
  }, photos));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin/student-photos`;
  const post = (role?: string, body: Uint8Array = png, origin = config.clientUrl) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'image/png', origin, ...(role ? { 'x-test-role': role } : {}) }, body,
  });
  try {
    assert.equal((await post()).status, 401);
    assert.equal((await post('student')).status, 403);
    assert.equal((await post('admin', png, 'https://evil.invalid')).status, 403);
    assert.equal(uploads, 0);
    const response = await post('admin');
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { avatarUrl: 'https://storage.test/photo.png' });
    assert.equal((await post('admin', Buffer.from('fake image'))).status, 400);
    assert.equal((await post('admin', Buffer.alloc(studentPhotoLimit + 1))).status, 413);
    assert.equal(uploads, 2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
