# Implementation

Finish the existing self-hosted application against `docs/SPEC.md` and the supplied PDF.

1. Build a persistent, user-isolated API: authentication, accounts, categories, transactions,
   Decimal calculations, migrations, and regression tests.
2. Build the React mobile UI using the supplied mockups and fonts, including offline entry.
3. Connect goals, wishlist, reviews, rules, quiz, insights, settings, and exports.
4. Complete optional features and deployment tooling; run backend, frontend, and integration checks.

Local development uses SQLite. Production uses the existing PostgreSQL / Caddy Docker topology.
Production deployment requires the owner's domain/server and optional VAPID credentials.
No deployment or fabricated financial history is part of development.

## Verified local result

- 35 backend tests pass, including financial calculations, auth refresh rotation,
  tenant isolation, review adjustments, sinking-fund spending, quips, and restore rollback.
- Frontend TypeScript compilation, production PWA build, ESLint, and 3 money-entry tests pass.
- Chromium at 390×844 passes the first-user journey, expense editing, wishlist entry,
  goal deposits, settings, session reload, offline shell reload, and deduplicated reconnect sync.
- `start.ps1` starts a clean local database and frontend; API/database health is checked.
- HTTPS hosting, Docker/PostgreSQL, physical phone installation and push delivery are unverified.
- Remaining full-spec polish is recorded in README. Local budgeting is ready for use.

## Category-flow correction

Registration no longer seeds categories or limits. Onboarding starts with an empty
list of user-named categories. Quick Add can create a category without losing the
expense draft, or save uncategorized online/offline. Uncategorized expenses affect
balances, spending and no-spend streaks, and can be categorized in History later.
Existing categories and transaction data remain intact. Verified with 37 backend
tests, 6 frontend tests, and both production-build browser journeys.

## User-flow audit (November 2, 2026)

The previous change fixed new accounts but left the old seeded budget in the
existing database. Migration 0002 recognizes the complete untouched registration
fingerprint, archives unused presets, clears invented limits, and preserves used
categories, transactions and balances. Customized budgets are left alone. The
upgrade was exercised against a database copy before applying it locally; a SQLite
backup is kept under `.runtime/chindi-before-flow-fixes-*.db`.

The browser walkthrough also exposed and corrected:

- Empty prior-month comparisons and Wrapped reports presented as real history.
- Archived account selection and missing historical account/category labels.
- Rejected queued entries reported as saved, and duplicate queue entries on retry.
- First-log account selection before Home finishes loading.
- Settings controls reverting temporarily while their request is in flight.
- Blank onboarding account rows silently discarded at registration.
- A payday prompt with no linked savings destination, and no indication of how
  much wishlist money remains available to allocate.

Production-build Chromium journeys now cover full/skipped setup, quiz, account
balances and card debt, custom categories, income, transfers, archive fallback,
expenses/edit/delete, offline replay, wishlist decisions, jar allocation, rejected
fund payments, subscriptions, cost per use, JSON restore, rules, weekly review,
Wrapped, login, and mobile/desktop overflow. Wishlist time advances only in the
isolated test database; requests and decisions use the real API. Screenshots and
failure traces are recorded under `frontend/test-results/`.

Final local checks: 42 backend tests, 6 frontend tests and 10 browser journeys
pass, along with Ruff, mypy, ESLint and the production PWA build. The ordinary app
is running at `http://127.0.0.1:5173/`, with migration 0002 applied and the live
database compared against its pre-upgrade backup.

## Sign-in, passkeys and recovery (November 2, 2026)

Login now offers Create account, Forgot password, and passkey sign-in. This local
installation permits additional registrations; private hosts can still disable
them. Users can enroll/remove a passkey and generate a private, single-use recovery
code in Settings after confirming their password. The login layout keeps account
creation visible on a phone without scrolling.

WebAuthn registration and authentication verify challenge, origin, RP ID, signature,
user verification and counters through the `webauthn` library. Challenges are bound
to HTTP-only browser cookies, expire after five minutes, and are consumed atomically.
Recovery secrets are hashed, excluded from exports, and invalidated after use or
replacement. Password reset revokes existing access/refresh sessions through a
password version as well as deleting stored sessions. Email reset is implemented
but unconfigured, as requested; the UI offers saved recovery codes instead.

Persistent-session reopening, real browser WebAuthn ceremonies with a virtual device
authenticator, passkey removal, and recovery while preserving spending are covered
in `frontend/e2e/auth.spec.ts`. Backend tests use real signed WebAuthn assertions
and check forgery, replay, wrong origin/challenge, missing user verification,
expiration, ownership, hashed/single-use recovery, session revocation and rate limits.
Physical phone Face ID and HTTPS hosting still require deployment and device testing.

Verified locally with 54 backend tests, 6 frontend tests and 13 production-build
browser journeys, plus Ruff, mypy, ESLint and the PWA build. Migrations 0003/0004
were verified against a copy before applying to the live database; existing user
and budget records match `.runtime/chindi-before-auth-*.db`. The live login page
was checked at `http://localhost:5173/` on a phone-sized viewport.

## Account type and removal correction (November 2, 2026)

Account cards and Home now show the saved account type. Accounts offers confirmed
permanent deletion for unused accounts, reversible archiving, and an Archived
accounts list with Restore. Deletion is guarded on the server against transactions
on either side of a transfer and linked goals, including activity added after a
list was loaded. Local queued entries block archive/delete. Archived accounts are
excluded from new goal/payday transfers as well as ordinary expense selection.

The existing archive API remains compatible; guarded permanent deletion uses a
separate endpoint. No schema migration or automatic account removal is involved.
Backend coverage checks ownership, actual removal, history/goal guards, late
activity and balance preservation on restore. Browser coverage checks displayed
types, cancel/confirm deletion, restore, retained receipts, and offline queue guards.

Verified with 61 backend tests, 6 frontend tests, 15 browser journeys, lint, type
checks and the production PWA build. The local app was restarted with the change;
the update performs no automatic data changes. Testing used the isolated browser
database. A backup of the live budget before the restart is available under
`.runtime/chindi-before-account-ui-*.db`.

## History category correction (November 2, 2026)

The History label lookup previously loaded the full archived category inventory and
reused it as filter options, which resurfaced unused starter categories. History
now uses an owner-scoped `/transactions/filters` projection built from actual
transactions. It includes both sides of transfers and preserves used archived
labels, while excluding unused categories/accounts. Empty history hides the filters.
Search/filter misses show a matching-entry empty state with a clear-filters action.

History offers Add category and Manage categories. The creation shortcut opens the
existing category form, with optional limits, using `create=1` to avoid the global
`add=1` expense shortcut. Categories remain optional and uncategorized entries keep
working. No categories or transactions are automatically deleted or reassigned.
Regression coverage checks unused archived presets, old receipt labels,
recategorization, transfer accounts, ownership, and category creation from History.

Verified with 64 backend tests, 6 frontend tests and 16 browser journeys, plus
lint, type checks and the production build. The running app's filter projection
was checked against its saved transactions to confirm unused archived categories
are excluded.

## Wishlist deletion (November 2, 2026)

Waiting and ready-to-decide wishlist cards now have a visible Delete button that
removes the item in one tap. The owner-scoped API deletes only undecided items,
without treating deletion as a let-go decision or changing points, spending,
balances, saved money or goal allocations. Completed decisions remain protected.
Conditional delete/decision updates prevent concurrent actions from deleting an
item after a savings decision has already been recorded.

Verified with 69 backend tests, 6 frontend tests and 17 browser journeys, including
deletion before/after the timer and preservation of financial totals. Lint, type
checks and the production build pass. The running app was restarted; the update
does not automatically delete any existing wishlist item.

## Combined monthly buckets (November 2, 2026)

Home now leads with the amount left across monthly monetary buckets, alongside
assigned and spent totals, an edit shortcut and the next renewal date. Active
fixed and flexible amount limits contribute; monetary sublimits are counted
inside a capped parent, or independently when the parent has no monetary cap.
Each expense is counted once, overspending stays negative, and expenses outside
these buckets are shown separately. The flexible daily average is labeled explicitly.

Limits recur on the local calendar's 1st without carryover or synthetic income/
transfers. Monthly transaction filtering preserves history and account balances;
no scheduler, migration or data rewrite is needed. The app refreshes owner-scoped
queries when its local date changes, including when returning to an open app.
Cached projections renew monthly usage and keep old queued receipts in their
original month. Client arithmetic uses integer cents with matching rounding.

Verified with 76 backend tests, 9 frontend tests and 18 browser journeys. Coverage
includes the St John's midnight boundary, New Year, leap year, missed months,
limit/expense edits, deletion, ownership, parent/child totals, fixed bills, spending
outside capped buckets, negative remaining, and offline sync. Phone layouts were
checked at 320, 390 and 430 pixels, plus desktop. Lint, type checks and the production
PWA build pass. The update does not modify saved monthly limits or financial records.

## Visible transaction ratings (November 2, 2026)

History previously buried purchase feelings in the account/type line and omitted
weekly review verdicts. Purchase feelings now have colored, labeled badges; blank
feelings explicitly show Not rated with an Add rating action. Tapping a badge opens
a small picker to add, change or clear only the feeling. Weekly review verdicts
appear separately. Offline queued entries show their saved ratings too. Quick Add
and History share the same picker, with accessible selected-button states.

No saved rating is inferred or backfilled. The existing owner-scoped transaction
PATCH handles the focused update. A regression test verifies all four feelings and
clearing round-trip through History without changing amounts, balances, dates,
metadata, budget totals or a saved weekly review verdict. Browser coverage checks
all labels, cancel/save/clear, reload persistence, phone layout, offline sync and
independent review verdicts. Verified with 77 backend tests, 9 frontend tests and
19 browser journeys, plus lint and the production build. The running Vite app
serves the update without a backend restart or database migration.

## Account types in payment choices (November 2, 2026)

Quick Add now shows each account's name and type on separate lines in Paid with
and Paid into. Selected options retain both labels, and expose their selected state
to assistive technology. Transfer destinations include types as well. History
passes account type metadata when editing an entry tied to an archived account,
so its original payment choice remains identifiable. Labels use the same type
names as account management and Home; no account data or selection IDs change.

Verified lint, type checks, the production build and all 20 browser journeys.
The new browser scenario creates two Scotiabank accounts with different types,
checks 320/390-pixel layouts, and verifies expense, income and transfer balances
on the selected accounts, plus editing an archived account's receipt. The running
app serves the change; no backend restart or migration is needed.

## Monthly average and installed app updates (November 2, 2026)

Home retains the no-spend streak and daily average while leading with monthly
bucket amounts left, assigned and spent. The average now names the current month
and identifies flexible spending as its scope. API and cached projections use only
that local calendar month's spending; usage/average renew on the 1st while streaks
continue across months. Boundary tests now explicitly check the average, including
zero usage, leap year, New Year and old queued receipts.

The local launcher was serving Vite development mode, where `/sw.js` returned
HTML. That prevents an installed production worker from receiving a valid update
and can leave an old cached Home screen visible. The normal launcher now builds
and serves the PWA with Vite preview. `-Dev` retains source reloads for development.
Installed clients check for worker updates when returning to the app or reconnecting.
No private storage is cleared to obtain an update.

Verified the current app at localhost:5173 serves a JavaScript update worker and
the bundle containing the monthly bucket headline. A browser scenario reloads the
app offline, advances into the next month while open, verifies $1,900 remaining
and $0 average, then logs $10 and verifies $1,890 remaining and $10 average without
resetting account balances or the streak. All 21 browser journeys pass, along with
9 frontend tests, the 13 targeted backend calculation/month-boundary tests, lint,
type checks and the PWA build. Launcher syntax and actual startup were checked.
The running app was restarted; saved financial records match the pre-restart backup.

## Account types in transaction history (November 2, 2026)

History cards and account filter options now include the saved account type beside
the account name. Transfers identify both source and destination; archived records
retain the type and archive marker. Queued entries use cached Home account labels
when the account has not yet appeared in saved History. Shared formatting avoids
guessing types from bank names and retains selection/filtering by account ID.

Verified lint, type checks, the production build and all 21 browser journeys.
The matching-name account scenario checks typed expense/income/transfer receipts,
filters by each account (including transfers on both sides), the archived receipt,
and 320/390-pixel layouts. Offline rating coverage also checks the queued account
type. The running production app serves the updated bundle; no data migration or
backend restart is involved.

## Visible transaction dates (November 2, 2026)

Quick Add shows Transaction date in the main form, defaulted to today in the user's
budget timezone. It supports missed transactions and date edits; Time remains in
Note, time & more. The chosen wall-clock date/time converts to UTC using the budget
timezone rather than the phone's timezone. Unchanged edits retain the original
timestamp exactly, including seconds and the selected DST occurrence. Invalid
calendar dates and nonexistent clock-change times produce a form error before
anything enters the offline queue.

The existing API recomputes monthly spending, daily averages and streaks from the
chosen occurrence date. Current-month bucket hints are hidden when selecting a
different month; editing a current expense restores its original amount in the
preview to avoid counting it twice. Offline entries retain the chosen date at sync.
No saved transaction is automatically redated and no schema migration is needed.

Verified 78 backend tests, 13 frontend tests and 22 browser journeys, plus lint,
formatting, type checks and the production PWA build. The new browser scenario uses
a UTC device with a St John's budget, checks visible date defaults, backdating
within/across months, a late-night month boundary, changing an existing date,
missing-date validation, 320/390-pixel layouts and offline sync. Unit coverage
includes half-hour offsets, DST transitions, leap day and timestamp preservation.
The running app serves the updated production bundle.
