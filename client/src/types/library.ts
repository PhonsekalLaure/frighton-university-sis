export interface LibraryBook {
  id: string | null;
  title: string;
  authors: string[];
  coverUrl: string | null;
}
export interface LibraryCatalog {
  items: Array<
    LibraryBook & { id: string; availableCopies: number; totalCopies: number; reservable: boolean }
  >;
  page: number;
  pageSize: number;
  total: number;
}
export interface LibraryAccount {
  reservations: Array<{
    id: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    pickupLocation: string;
    book: LibraryBook;
  }>;
  loans: Array<{ id: string; borrowedAt: string; dueAt: string; overdueDays: number; book: LibraryBook }>;
  unpaidFines: Array<{
    id: string;
    amount: number;
    currency: string;
    reason: string;
    kind: string;
    assessedAt: string | null;
  }>;
  eligibility: { canReserve: boolean; reason: string | null };
}
