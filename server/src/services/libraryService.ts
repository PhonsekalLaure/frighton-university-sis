import { getSupabaseAdmin } from '../config/supabase.js';
import { libraryEligibility } from './libraryEligibility.js';
import { lmsRequest, validLms, LibraryError } from './lmsClient.js';
import {
  isCatalog,
  isAccount,
  isReservation,
  type LibraryBook,
  type LibraryAccount,
} from './libraryContracts.js';
function localCover<T extends LibraryBook>(b: T): T {
  return {
    ...b,
    coverUrl: b.id && b.coverUrl ? '/api/v1/library/books/' + encodeURIComponent(b.id) + '/cover' : null,
  };
}
export class SISLibraryService {
  constructor(
    private readonly client = getSupabaseAdmin,
    private readonly upstream = lmsRequest,
  ) {}
  async identity(id: string) {
    const r = await this.client()
      .from('profiles')
      .select('student_number')
      .eq('id', id)
      .eq('role', 'student')
      .maybeSingle();
    if (r.error)
      throw new LibraryError(503, 'IDENTITY_UNAVAILABLE', 'Student identity could not be verified.');
    if (!r.data?.student_number)
      throw new LibraryError(404, 'PROFILE_NOT_FOUND', 'Your student profile has not been provisioned.');
    return r.data.student_number as string;
  }
  async books(query: URLSearchParams) {
    const c = validLms(await this.upstream('/service/v1/books?' + query), isCatalog);
    return { ...c, items: c.items.map(localCover) };
  }
  async account(id: string) {
    const number = await this.identity(id);
    const [account, eligibility] = await Promise.all([
      this.upstream('/service/v1/students/' + encodeURIComponent(number) + '/account'),
      libraryEligibility(number, this.client()),
    ]);
    const a: LibraryAccount = validLms(account, isAccount);
    const hasReplacement = a.unpaidFines.some((f) => f.kind === 'replacement');
    return {
      ...a,
      reservations: a.reservations.map((r) => ({ ...r, book: localCover(r.book) })),
      loans: a.loans.map((l) => ({ ...l, book: localCover(l.book) })),
      eligibility: {
        canReserve: eligibility.canBorrow && a.loans.length === 0 && !hasReplacement,
        reason: !eligibility.canBorrow
          ? 'Your account has an active restriction or is not eligible.'
          : a.loans.length
            ? 'Return your borrowed book before reserving another.'
            : hasReplacement
              ? 'Clear unpaid replacement charges at the library desk before reserving.'
              : null,
      },
    };
  }
  async reserve(id: string, bookId: string) {
    const number = await this.identity(id),
      eligibility = await libraryEligibility(number, this.client());
    if (!eligibility.canBorrow)
      throw new LibraryError(403, 'INELIGIBLE', 'Your account is not eligible. Review your Holds page.');
    const r = validLms(
      await this.upstream('/service/v1/reservations', 'POST', { studentNumber: number, bookId }),
      isReservation,
    );
    if (r.book.id !== bookId)
      throw new LibraryError(
        503,
        'INVALID_LMS_RESPONSE',
        'The reservation outcome could not be confirmed. Reload your account.',
      );
    return { ...r, book: localCover(r.book) };
  }
  async cancel(id: string, reservationId: string) {
    const number = await this.identity(id);
    await this.upstream('/service/v1/reservations/' + reservationId, 'DELETE', { studentNumber: number });
  }
  image(id: string) {
    return this.upstream('/service/v1/books/' + id + '/cover', 'GET', undefined, true);
  }
}
