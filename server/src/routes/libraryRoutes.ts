import { Router } from 'express';
import { requireAuth, requireStudent } from '../middlewares/auth.js';
import { config } from '../config/env.js';
import { SISLibraryService } from '../services/libraryService.js';
import { LibraryError } from '../services/lmsClient.js';
export function libraryUuid(value: unknown) {
  if (typeof value !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value))
    throw new LibraryError(400, 'INVALID_REQUEST', 'A valid resource ID is required.');
  return value;
}
export function createLibraryRouter(service = new SISLibraryService(), authenticate = requireAuth) {
  const r = Router();
  r.use(authenticate, requireStudent);
  r.use((_req, _res, next) => {
    if (!config.lms.enabled)
      return next(new LibraryError(503, 'LIBRARY_DISABLED', 'Library self-service is not available yet.'));
    next();
  });
  const route = (fn: (req: any, res: any) => Promise<void>) => (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
  r.get(
    '/books',
    route(async (req, res) => {
      const q = req.query.q ?? '',
        page = req.query.page ?? '1',
        pageSize = req.query.pageSize ?? '20';
      if (
        typeof q !== 'string' ||
        q.length > 100 ||
        /[,()"\x00-\x1f]/.test(q) ||
        typeof page !== 'string' ||
        !/^[1-9]\d{0,4}$/.test(page) ||
        typeof pageSize !== 'string' ||
        !/^[1-9]\d*$/.test(pageSize) ||
        Number(pageSize) > 100
      )
        throw new LibraryError(400, 'INVALID_REQUEST', 'Enter valid search and page values.');
      res.json(await service.books(new URLSearchParams({ q: q.trim(), page, pageSize })));
    }),
  );
  r.get(
    '/books/:id/cover',
    route(async (req, res) => {
      const image = await service.image(libraryUuid(req.params.id));
      res.type(image.contentType).send(image.bytes);
    }),
  );
  r.get(
    '/me',
    route(async (req, res) => {
      res.json(await service.account((req.user ?? res.locals.user).id));
    }),
  );
  r.post(
    '/reservations',
    route(async (req, res) => {
      if (!req.body || Object.keys(req.body).some((k) => k !== 'bookId'))
        throw new LibraryError(400, 'INVALID_REQUEST', 'Only bookId is accepted.');
      res
        .status(201)
        .json(await service.reserve((req.user ?? res.locals.user).id, libraryUuid(req.body.bookId)));
    }),
  );
  r.delete(
    '/reservations/:id',
    route(async (req, res) => {
      if (req.body && Object.keys(req.body).length)
        throw new LibraryError(400, 'INVALID_REQUEST', 'Do not supply student identity.');
      await service.cancel((req.user ?? res.locals.user).id, libraryUuid(req.params.id));
      res.status(204).end();
    }),
  );
  return r;
}
