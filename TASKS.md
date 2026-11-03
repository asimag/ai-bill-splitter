# Tasks

## Active

- [ ] **Stage 3 — Evaluate receipts and device capture**
  - Test representative real restaurant receipts, including blurry/skewed images and varied layouts.
  - Check included tax/service charges, subtotal versus total, and unreadable amounts.
  - Report observed extraction accuracy and failure cases; use synthetic fixtures for automated tests.
  - Verify receipt access isolation and document actual iPhone/Android camera checks.
  - *Status 2026-11-03: access isolation and the full pipeline are verified (automated + live curl, `scripts/e2e-stage3.sh`); one synthetic rendered receipt extracted perfectly by the local model (all fields incl. total-vs-cash-tendered). Still needed: a pass over real photographed receipts and iPhone/Android camera confirmation with the app installed or in a mobile browser.*

- [ ] **Stage 4 — Make the app installable**
  - Add a web app manifest, icons, service worker, HTTPS-compatible setup, and home-screen guidance.
  - Cache the app shell without broadly caching private authenticated API responses.

- [ ] **Stage 4 — Save travel expense drafts offline**
  - Use IndexedDB for new expense drafts and receipt images, with enough cached trip data to create them.
  - Preserve drafts across reloads and show local-only, uploading, review-needed, and confirmed states.
  - Explain that local drafts are not backed up until uploaded; handle storage failures visibly.
  - Clear or isolate private local data on logout/account changes.

- [ ] **Stage 4 — Retry uploads safely**
  - Retry while the app is open and connectivity returns; do not depend on background sync.
  - Use stable submission IDs, server idempotency, and atomic writes to prevent duplicate expenses.
  - Test reloads, network interruption, repeated submissions, and server rejection of outdated membership/trip status.

- [ ] **Stage 5 — Complete and reopen trips**
  - Closing a trip freezes expense changes until reopened, while allowing repayments to be recorded.
  - Closing must not mark unpaid balances as settled.
  - Provide per-person expense breakdowns and remaining settlement suggestions.

- [ ] **Stage 5 — Export trip results**
  - Provide copyable summaries and CSV exports of expenses, participant shares, balances, and repayments.
  - Include currency and clearly distinguish suggested transfers from recorded repayments.

- [ ] **Stage 5 — Finish mobile usability**
  - Check quick split, trip list, creation, participants, expenses, receipt review, balances, and repayments.
  - Provide loading, empty, validation, error, and retry states with accessible inputs and touch controls.

- [ ] **Stage 5 — Prepare self-hosted deployment**
  - Complete Docker Compose, migrations, environment examples, health checks, and persistent database/receipt volumes.
  - Document HTTPS configuration, secrets, deployment commands, and database plus receipt backup/restore.
  - Verify restoration using a test backup; do not commit real receipts or credentials.

- [ ] **Stage 5 — Run the final end-to-end check**
  - Create a trip → add people → add manual/scanned expenses → override one expense's weights → review balances → record a repayment → close trip → export results.
  - Check restart persistence, organizer isolation, rounding, OCR fallback, and interrupted upload recovery.
  - Report checks actually run and remaining limitations; public deployment requires a user request.

## Waiting On

## Someday

- [ ] **Allow participant accounts and collaborative trip editing** - add invitations, roles, and conflict handling after the organizer workflow works.
- [ ] **Support multiple currencies within a trip** - define exchange-rate sources, rate dates, and conversion/rounding rules first.
- [ ] **Add item-by-item receipt splitting** - retain weighted total splitting as the default workflow.
- [ ] **Support multiple payers per expense and refunds** - extend the financial model with dedicated acceptance tests.
- [ ] **Evaluate a native iOS app** - revisit if offline OCR or a live document scanner becomes essential.
- [ ] **Add payment-provider integration** - keep the first release focused on tracking and recording repayments.

## Done

- [x] ~~Stage 3 — Capture and privately store receipts: camera/gallery capture with client-side preview, 90° rotation (canvas re-encode) and retake; content-sniffed JPEG/PNG/WebP validation + size limit (multer memory, magic bytes); files under a private dir per organizer, never statically served, streamed only through authorized `GET /receipts/:id/image` (`private, no-store`); receipts tied to trip+organizer, attachable to exactly one expense (unique `expense.receipt_id`); unattached receipts visible on the trip page for review/discarded~~ (2026-11-03) — Live curl round-trip: upload → byte-identical streaming → confirm → isolation 404s for other organizers. Caveat: capture/rotate/retake UI passed typecheck + production build but has not had a real-device (iPhone/Android) browser pass.
- [x] ~~Stage 3 — Switchable receipt AI providers: one `ReceiptAiAdapter` interface with runtime-validated `Extraction` (merchant/date/currency/subtotal/tax/service/tip/cash-tendered/total as decimal strings + warnings; missing fields null, ambiguous dates/amounts dropped, never guessed); OpenAI-compatible local adapter (endpoint/model/key on backend env); Gemini Flash adapter with configurable model ID (default `gemini-3.6-flash`, verified stable + image-capable 2026-11-03 against ai.google.dev docs); Tesseract demoted to an optional explicit-mode-only heuristic adapter; extraction runs off the request path (row-claimed background job, pending/processing/extracted/failed + retry); prompt demands the FINAL payable total with included charges never added twice, confirmed against the real local model; expenses are only created when the organizer submits the (pre-filled, fully editable) form — extraction alone never touches totals; optional `extraTip` added in exact minor-unit arithmetic only when not already included; all allocation stays in `@billsplit/core`~~ (2026-11-03) — Live round-trip on the local MLX vision model extracted every field of a synthetic receipt correctly (34.00 + 1.70 tax + 3.40 service + 2.90 tip → total 42.00, cash tendered 50.00 not confused with total). Caveat: Gemini adapter has no automated test against the real API (no key configured); Tesseract binary not installed on the dev machine (parser unit-tested only).
- [x] ~~Stage 3 — Automatic local→Gemini fallback: auto mode tries local first, falls back on unconfigured/unreachable/timeout/image-incompatible/invalid output with one bounded attempt per provider and `RECEIPT_AI_TIMEOUT_MS` (AbortSignal); local-only mode makes zero cloud calls, gemini-only bypasses local; provider used + sanitized single-line fallback trace stored on each receipt; auto retries local again on every later job once it recovers; missing Gemini key → receipt kept, `error_kind=credentials` with an in-app link to settings; rate_limit vs credentials kinds distinguished; job row-claim + unique expense.receipt_id make retry/fallback unable to duplicate expenses~~ (2026-11-03) — Mocked-adapter integration tests for all paths + live outage drill (local endpoint down → failed receipt preserved with trace "local: failed (unavailable)…; gemini: skipped (credentials) no Gemini API key configured"). Caveat: successful real Gemini fallback not exercised (no key configured).
- [x] ~~Stage 3 — Provider settings and secure API-key entry: backend env `RECEIPT_AI_MODE`/`LOCAL_AI_BASE_URL`/`LOCAL_AI_MODEL`/`LOCAL_AI_API_KEY`/`GEMINI_MODEL`/`GEMINI_API_KEY`/`RECEIPT_AI_TIMEOUT_MS` (+ `CREDENTIALS_SECRET`, `RECEIPT_STORAGE_DIR`, `RECEIPT_MAX_BYTES`); local endpoint/model operator-only (env), documented container-reachability caveat in compose + settings page; authenticated Settings page: mode select, Gemini model, key paste → encrypted at rest (AES-256-GCM, separate server-only secret), masked status (`saved`/`environment`/`none`), test-connection per provider, key replace/remove restoring environment defaults; plaintext keys never returned by any read API and input fields cleared after submit~~ (2026-11-03) — Tests: masked GET never contains key material (asserted on serialized JSON), saved-key precedence per organizer with removal restoring defaults, other organizer sees no saved key; live settings check shows no secrets. Caveat: HTTPS is a deployment concern (compose serves behind a reverse proxy); key entry itself verified at API level, not in a browser.
- [x] ~~Stage 3 — Verify provider switching, fallback, and key isolation: 12 integration tests (real app + real PostgreSQL `billsplit_test_s3`) plus 12 extraction-boundary unit tests over local success, local outage→Gemini with recorded reason, local-only never calls Gemini, Gemini-only bypass, local recovery on later uploads, missing-key credentials prompt → save key → retry succeeds, rate_limit/image kinds distinguishable, duplicate confirm/retry cannot create a second expense, identical extraction → identical allocations, extra tip exactness (52.80+2.20=5500 minor), upload validation (400 fake bytes/413 oversize), receipt/image/retry/delete 404 for foreign organizers, encrypted-key round trip + tamper refusal, envelope/amount/date validation, HTTP error classification, redaction of key-shaped strings~~ (2026-11-03) — `npm test` green: 17 core + 12 AI-unit + 9 Stage-2 + 12 Stage-3 tests (45 total); provider-independent allocation equality asserted end-to-end after confirmation.

- [x] ~~Stage 2 — Suggest settlement transfers: greedy largest-debtor/creditor matching in `@billsplit/core` (`suggestTransfers`), returned as `suggestions` on trip detail; deterministic, ≤ n−1 transfers, explicitly not claimed minimal; suggestions are advice only and verified not to change balances~~ (2026-11-03)
- [x] ~~Stage 2 — Record and reverse repayments: `repayment` table (sender, recipient, amount, date, note) stored separately from expenses; net = paid − shares + sent − received counting only `recorded` rows; corrections via PUT, reversal flips status and keeps the row as visible history (restore re-counts exactly once); repayments allowed for archived participants and on closed trips (Stage 5 prerequisite)~~ (2026-11-03) — Live curl round-trip (record → balances shift → reverse → restore → correct) verified against the dev server.
- [x] ~~Stage 2 — Focused automated financial tests: 17 core unit tests (allocation examples, rounding, zero-sum, suggestions) plus 9 new API integration tests (`apps/server/test`) running the real Express app against a real PostgreSQL test DB — 9,000-at-1:2:1 example end-to-end, 34/33/33 stable order, exclusion + weight snapshots, edit/delete recalculation, repayment record/reverse/restore/correct without double-counting, validation, JOD/JPY precision, organizer isolation, allocation sums == expense totals, zero-sum nets~~ (2026-11-03) — `npm test` green; caught and fixed one real bug (amount parser accepted a trailing dot). Caveat: new trip-page UI (suggestions card, repayment form/history) passed typecheck + production build but has not had a visual browser pass yet.

- [x] ~~Stage 1 — Initialize the application: React/TS/Vite web, Node/TS API, PostgreSQL, Docker Compose, dev commands, `.env.example`, migrations, mobile layout; commands recorded in AGENTS.md~~ (2026-11-03) — Caveat: Docker Compose config is committed but not yet run; the dev Mac has no Docker engine.
- [x] ~~Stage 1 — Organizer authentication and ownership: register/login/logout, session cookie, ownership enforced server-side on every trip/participant/expense operation~~ (2026-11-03) — Verified with cross-organizer isolation checks (404s) and 401 without a session.
- [x] ~~Stage 1 — Trips and participants: name/dates/currency/status, positive integer default weights, archive instead of delete (archived people are refused on new expenses, history kept)~~ (2026-11-03)
- [x] ~~Stage 1 — Allocation engine: integer minor units with per-currency precision, exact BigInt proportional shares, largest-remainder leftovers with stable-order tie-breaker, allocations always sum to the amount~~ (2026-11-03) — 11 unit tests including the AGENTS.md examples.
- [x] ~~Stage 1 — Quick split: amount, currency, people, and weights without a trip; per-person shares plus copyable summary, reusing the shared engine in the browser~~ (2026-11-03) — API-level behavior verified; browser visual pass pending.
- [x] ~~Stage 1 — Manual trip expenses: description/date/category/confirmed total/one payer/included participants with weights; validation of amount, membership, and minimum inclusion; per-expense weight snapshots (default changes never rewrite past bills); edit and delete recalculate balances~~ (2026-11-03)
- [x] ~~Stage 1 — Trip overview and running balances: expense list, total spent, per-person paid/share/net; only confirmed expenses enter totals (drafts excluded at query level)~~ (2026-11-03) — Verified: 1:2:1 examples, 34/33/33 rounding, zero-sum balances.
- [x] ~~Document the staged implementation checklist and initialize project AGENTS.md~~ (2026-11-03)

- [x] ~~Document switchable local vision AI, automatic Gemini Flash fallback, and secure in-app API-key configuration~~ (2026-11-03)
