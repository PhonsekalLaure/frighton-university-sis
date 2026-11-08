import { useState, type FormEvent } from 'react';
import { BookOpen, BookOpenCheck, Search, ShieldAlert } from 'lucide-react';
import { SectionHeading, ErrorState, LoadingState } from '../components/PageStates';
import { useApiRead } from '../lib/useApiRead';
import { apiGet, apiPost, apiDelete, type ApiFailure } from '../lib/api';
import type { LibraryBook, LibraryCatalog, LibraryAccount } from '../types/library';
import type { PortalView } from '../components/AppShell';
const date = (value: string) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
const money = (amount: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
function Cover({ book }: { book: LibraryBook }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="library-cover">
      {book.coverUrl && !failed ? (
        <img src={book.coverUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <BookOpen aria-hidden="true" size={30} />
      )}
    </div>
  );
}
function PendingLibrary() {
  return (
    <section className="library-pending-card">
      <BookOpenCheck size={29} />
      <div>
        <p className="eyebrow">COMING SOON</p>
        <h2>Library self-service is not available yet</h2>
        <p>
          Catalog search, reservations, loans, and read-only fines will appear here when the connection is
          ready.
        </p>
      </div>
    </section>
  );
}
export function LibraryPage({ onNavigate }: { onNavigate?: (view: PortalView) => void }) {
  const [draft, setDraft] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const [pending, setPending] = useState(''),
    [message, setMessage] = useState(''),
    [mutationError, setMutationError] = useState('');
  const [uncertain, setUncertain] = useState(false),
    [cancelId, setCancelId] = useState<string | null>(null);
  const account = useApiRead<LibraryAccount>('/api/v1/library/me');
  const catalog = useApiRead<LibraryCatalog>(
    '/api/v1/library/books?' + new URLSearchParams({ q: query, page: String(page), pageSize: '12' }),
  );
  async function refreshAccount() {
    // A fresh account read must complete before another uncertain write is offered.
    await apiGet<LibraryAccount>('/api/v1/library/me');
    account.retry();
    catalog.retry();
    setUncertain(false);
  }
  async function act(kind: 'reserve' | 'cancel', id: string) {
    setPending(id);
    setMutationError('');
    setMessage('');
    try {
      if (kind === 'reserve') await apiPost('/api/v1/library/reservations', { bookId: id });
      else await apiDelete('/api/v1/library/reservations/' + encodeURIComponent(id));
      setMessage(
        kind === 'reserve' ? 'Your reservation is ready for Main Library pickup.' : 'Reservation cancelled.',
      );
      setCancelId(null);
      account.retry();
      catalog.retry();
    } catch (error) {
      const failure = error as ApiFailure;
      setMutationError(failure.message);
      catalog.retry();
      account.retry();
      if (kind === 'reserve' && (!failure.status || failure.status >= 500)) {
        setUncertain(true);
        try {
          await refreshAccount();
        } catch {
          setMutationError(
            'The reservation outcome could not be confirmed. Reload your account before trying again.',
          );
        }
      }
    } finally {
      setPending('');
    }
  }
  function search(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim());
    setPage(1);
  }
  const disabled = account.error?.code === 'LIBRARY_DISABLED' || catalog.error?.code === 'LIBRARY_DISABLED';
  return (
    <>
      <SectionHeading
        eyebrow="FRIGHTON UNIVERSITY LIBRARY"
        title="Library services"
        description="Find a book, reserve a copy, and review your library account."
      />
      {disabled ? (
        <PendingLibrary />
      ) : (
        <>
          {message && (
            <p className="library-notice" role="status">
              {message}
            </p>
          )}
          {mutationError && (
            <div className="library-warning" role="alert">
              {mutationError}
              {uncertain && (
                <button
                  type="button"
                  disabled={!!pending}
                  onClick={() => {
                    void refreshAccount().catch(() =>
                      setMutationError('Your account is still unavailable. Please try again later.'),
                    );
                  }}
                >
                  Reload my account
                </button>
              )}
            </div>
          )}
          {account.error ? (
            <ErrorState message={account.error.message} onRetry={account.retry} />
          ) : !account.data ? (
            <LoadingState />
          ) : (
            <>
              {!account.data.eligibility.canReserve && (
                <div className="library-warning">
                  <ShieldAlert size={20} />
                  <span>{account.data.eligibility.reason}</span>
                  <button type="button" onClick={() => onNavigate?.('holds')}>
                    Review Holds
                  </button>
                </div>
              )}
              <div className="library-account-grid">
                <section className="content-card">
                  <h2>My reservations</h2>
                  {!account.data.reservations.length ? (
                    <p>No active reservations.</p>
                  ) : (
                    account.data.reservations.map((r) => (
                      <article className="library-account-item" key={r.id}>
                        <h3>{r.book.title}</h3>
                        <p>Ready for pickup · {r.pickupLocation}</p>
                        <p>
                          Reserved {date(r.createdAt)}
                          <br />
                          Expires {date(r.expiresAt)}
                        </p>
                        {cancelId === r.id ? (
                          <div>
                            <p>Cancel this reservation and release the copy?</p>
                            <button disabled={!!pending} onClick={() => void act('cancel', r.id)}>
                              Confirm cancellation
                            </button>{' '}
                            <button disabled={!!pending} onClick={() => setCancelId(null)}>
                              Keep reservation
                            </button>
                          </div>
                        ) : (
                          <button disabled={!!pending} onClick={() => setCancelId(r.id)}>
                            Cancel reservation
                          </button>
                        )}
                      </article>
                    ))
                  )}
                </section>
                <section className="content-card">
                  <h2>Current loans</h2>
                  {!account.data.loans.length ? (
                    <p>No current loans.</p>
                  ) : (
                    account.data.loans.map((l) => (
                      <article className="library-account-item" key={l.id}>
                        <h3>{l.book.title}</h3>
                        <p>Due {date(l.dueAt)}</p>
                        <p>{l.overdueDays ? `${l.overdueDays} days overdue` : 'Within loan period'}</p>
                      </article>
                    ))
                  )}
                </section>
                <section className="content-card">
                  <h2>Unpaid library amounts</h2>
                  {!account.data.unpaidFines.length ? (
                    <p>No unpaid fines or replacement charges.</p>
                  ) : (
                    account.data.unpaidFines.map((f) => (
                      <article className="library-account-item" key={f.id}>
                        <h3>{money(f.amount)}</h3>
                        <p>{f.reason}</p>
                        {f.kind === 'overdue_accrual' && (
                          <small>Accruing estimate; the final amount is calculated on return.</small>
                        )}
                      </article>
                    ))
                  )}
                  <p className="supporting-copy">
                    Visit the library desk to settle charges. Amounts are read-only here.
                  </p>
                </section>
              </div>
            </>
          )}
          <section className="library-catalog" aria-labelledby="catalog-title">
            <h2 id="catalog-title">Search the catalog</h2>
            <form className="library-search" onSubmit={search}>
              <label htmlFor="library-query">Title or author</label>
              <div>
                <input
                  id="library-query"
                  maxLength={100}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Find your next book"
                />
                <button type="submit">
                  <Search size={16} /> Search
                </button>
              </div>
            </form>
            {catalog.error ? (
              <ErrorState message={catalog.error.message} onRetry={catalog.retry} />
            ) : !catalog.data ? (
              <LoadingState />
            ) : (
              <>
                {!catalog.data.items.length ? (
                  <p className="empty-row">No books match your search.</p>
                ) : (
                  <div className="library-book-grid">
                    {catalog.data.items.map((b) => (
                      <article className="content-card library-book" key={b.id}>
                        <Cover book={b} />
                        <h3>{b.title}</h3>
                        <p>{b.authors.join(', ')}</p>
                        <p>
                          {b.availableCopies} of {b.totalCopies} copies available
                        </p>
                        <button
                          disabled={
                            !!pending ||
                            uncertain ||
                            !account.data?.eligibility.canReserve ||
                            !b.reservable ||
                            account.data.reservations.some((r) => r.book.id === b.id)
                          }
                          onClick={() => void act('reserve', b.id)}
                        >
                          {pending === b.id ? 'Reserving…' : 'Reserve for pickup'}
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                <nav className="library-pagination" aria-label="Catalog pages">
                  <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </button>
                  <span>
                    Page {page} · {catalog.data.total} books
                  </span>
                  <button
                    disabled={page * catalog.data.pageSize >= catalog.data.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </nav>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
