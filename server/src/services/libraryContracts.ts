export interface LibraryBook {
  id: string | null;
  title: string;
  authors: string[];
  coverUrl: string | null;
}
export interface Reservation {
  id: string;
  status: 'ready_for_pickup';
  createdAt: string;
  expiresAt: string;
  pickupLocation: string;
  book: LibraryBook & { id: string };
}
export interface LibraryAccount {
  reservations: Reservation[];
  loans: Array<{ id: string; borrowedAt: string; dueAt: string; overdueDays: number; book: LibraryBook }>;
  unpaidFines: Array<{
    id: string;
    amount: number;
    currency: 'PHP';
    reason: string;
    kind: 'replacement' | 'overdue_accrual' | 'overdue_assessed';
    assessedAt: string | null;
    calculatedAt?: string;
  }>;
}
export interface Catalog {
  items: Array<
    LibraryBook & {
      id: string;
      isbn: string | null;
      availableCopies: number;
      totalCopies: number;
      reservable: boolean;
    }
  >;
  page: number;
  pageSize: number;
  total: number;
}
export interface DebtSnapshot {
  studentNumber: string;
  version: number;
  qualifyingDebtCount: number;
  amount: number;
  currency: 'PHP';
  reason: string;
}
const string = (x: unknown): x is string => typeof x === 'string';
const integer = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
const date = (x: unknown) =>
  string(x) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const book = (b: any) =>
  b &&
  (b.id === null || string(b.id)) &&
  string(b.title) &&
  Array.isArray(b.authors) &&
  b.authors.every(string) &&
  (b.coverUrl === null || string(b.coverUrl));
export function isReservation(r: any): r is Reservation {
  return (
    !!r &&
    string(r.id) &&
    r.status === 'ready_for_pickup' &&
    date(r.createdAt) &&
    date(r.expiresAt) &&
    r.pickupLocation === 'Main Library' &&
    book(r.book) &&
    string(r.book.id)
  );
}
export function isCatalog(c: any): c is Catalog {
  return (
    !!c &&
    integer(c.page) &&
    c.page > 0 &&
    integer(c.pageSize) &&
    c.pageSize > 0 &&
    c.pageSize <= 100 &&
    integer(c.total) &&
    Array.isArray(c.items) &&
    c.items.length <= c.pageSize &&
    c.items.every(
      (b: any) =>
        book(b) &&
        string(b.id) &&
        integer(b.availableCopies) &&
        integer(b.totalCopies) &&
        b.availableCopies <= b.totalCopies &&
        typeof b.reservable === 'boolean',
    )
  );
}
export function isAccount(a: any): a is LibraryAccount {
  return (
    !!a &&
    Array.isArray(a.reservations) &&
    a.reservations.every(isReservation) &&
    Array.isArray(a.loans) &&
    a.loans.every(
      (l: any) =>
        l && string(l.id) && date(l.borrowedAt) && date(l.dueAt) && integer(l.overdueDays) && book(l.book),
    ) &&
    Array.isArray(a.unpaidFines) &&
    a.unpaidFines.every(
      (f: any) =>
        f &&
        string(f.id) &&
        Number.isFinite(f.amount) &&
        f.amount >= 0 &&
        f.currency === 'PHP' &&
        string(f.reason) &&
        ['replacement', 'overdue_accrual', 'overdue_assessed'].includes(f.kind) &&
        (f.assessedAt === null || date(f.assessedAt)),
    )
  );
}
export function isDebtSnapshot(d: any, number: string): d is DebtSnapshot {
  return (
    !!d &&
    d.studentNumber === number &&
    integer(d.version) &&
    d.version > 0 &&
    integer(d.qualifyingDebtCount) &&
    Number.isFinite(d.amount) &&
    d.amount >= 0 &&
    (d.qualifyingDebtCount > 0 || d.amount === 0) &&
    d.currency === 'PHP' &&
    string(d.reason) &&
    d.reason.length <= 1000
  );
}
