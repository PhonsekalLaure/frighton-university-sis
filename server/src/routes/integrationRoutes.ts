import { Router, type RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { libraryEligibility } from '../services/libraryEligibility.js';
import { LibraryError } from '../services/lmsClient.js';
import { isDebtSnapshot } from '../services/libraryContracts.js';
import { latestDebt, applyDebt } from '../services/libraryDebt.js';
const auth: RequestHandler = (req, res, next) => {
  const supplied = Buffer.from(req.get('x-lms-api-key') ?? req.get('x-api-key') ?? ''),
    expected = Buffer.from(config.lms.apiKey);
  if (
    !expected.length ||
    config.lms.apiKey === config.lms.serviceKey ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    res
      .status(401)
      .json({ error: 'Unauthorized: Invalid or missing integration API key', code: 'UNAUTHORIZED' });
    return;
  }
  if (req.get('origin')) {
    res.status(403).json({ error: 'Server-to-server access required.', code: 'FORBIDDEN' });
    return;
  }
  next();
};
function number(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Z0-9][A-Z0-9-]{0,49}$/.test(value))
    throw new LibraryError(400, 'INVALID_REQUEST', 'A valid studentNumber is required.');
  return value;
}
function uuid(value: unknown) {
  if (typeof value !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value))
    throw new LibraryError(400, 'INVALID_REQUEST', 'A valid hold ID is required.');
  return value;
}
const route =
  (fn: (req: any, res: any) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
export const integrationRouter = Router();
integrationRouter.use(auth);
integrationRouter.get(
  '/students/:studentNumber/status',
  route(async (req, res) => {
    res.json(await libraryEligibility(number(req.params.studentNumber)));
  }),
);
integrationRouter.put(
  '/library-debt/:studentNumber',
  route(async (req, res) => {
    const n = number(req.params.studentNumber);
    if (!isDebtSnapshot(req.body, n))
      throw new LibraryError(400, 'INVALID_REQUEST', 'A valid versioned debt snapshot is required.');
    res.json(await applyDebt(req.body));
  }),
);
// Compatibility routes no longer trust arbitrary amounts or a single cleared debt item.
integrationRouter.post(
  '/holds',
  route(async (req, res) => {
    const snapshot = await latestDebt(number(req.body?.studentNumber));
    res.json(await applyDebt(snapshot));
  }),
);
integrationRouter.post(
  '/holds/:holdId/resolve',
  route(async (req, res) => {
    const db = getSupabaseAdmin();
    const hold = await db
      .from('student_holds')
      .select('student_id')
      .eq('id', uuid(req.params.holdId))
      .eq('hold_type', 'library_debt')
      .eq('placed_by_system', 'Frighton LMS')
      .maybeSingle();
    if (hold.error)
      throw new LibraryError(503, 'DEBT_SYNC_UNAVAILABLE', 'Library hold could not be verified.');
    if (!hold.data) throw new LibraryError(404, 'HOLD_NOT_FOUND', 'LMS library hold was not found.');
    const profile = await db
      .from('profiles')
      .select('student_number')
      .eq('id', hold.data.student_id)
      .single();
    if (profile.error || !profile.data)
      throw new LibraryError(503, 'DEBT_SYNC_UNAVAILABLE', 'Student could not be verified.');
    const snapshot = await latestDebt(profile.data.student_number);
    if (snapshot.qualifyingDebtCount > 0)
      throw new LibraryError(409, 'LIBRARY_DEBT_REMAINS', 'Qualifying library debt remains.');
    const result = await applyDebt(snapshot);
    res.json(result);
  }),
);
