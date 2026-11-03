# Tasks

## Active

- [ ] **Stage 2 — Suggest settlement transfers**
  - Match participants who owe money with those who should receive it.
  - Positive net balance means money to receive; negative means money owed.
  - Suggestions alone must not change balances; do not claim a globally minimal transfer count.

- [ ] **Stage 2 — Record and reverse repayments**
  - Store sender, recipient, amount, and date separately from expenses.
  - Compute net = expenses paid - allocated shares + repayments sent - repayments received.
  - Support corrections/reversals and show repayment history without double-counting transfers.

- [ ] **Stage 2 — Verify financial rules with focused automated tests**
  - A 6,000 bill with weights 1:2:1 gives shares of 1,500 / 3,000 / 1,500.
  - For bills totalling 9,000 at weights 1:2:1, with Ali paying 6,000 and Sara 3,000: shares are 2,250 / 4,500 / 2,250; Ali receives 3,750, Sara owes 1,500, and Ahmed owes 2,250.
  - Excluded participants receive zero allocation; changing defaults preserves existing allocations.
  - A 100-minor-unit bill divided equally three ways allocates 34 / 33 / 33 in stable participant order.
  - Expense edits/deletions, repayment recording/reversal, invalid input, and currency precision behave correctly.
  - Every allocation sums to its expense total, and trip net balances sum to zero.

- [ ] **Stage 3 — Capture and privately store receipts**
  - Support mobile camera capture and image upload with preview, rotation, and retaking.
  - Validate file content/type and size; keep files outside public web roots on a persistent volume.
  - Authorize receipt retrieval and associate each receipt with its expense and organizer.

- [ ] **Stage 3 — Add switchable receipt AI providers**
  - Define a shared extraction interface and validated structured result for totals, currency, identifiable charges, merchant/date, and uncertainty.
  - Prefer the user's local image-capable AI via a configurable OpenAI-compatible adapter; keep endpoint, model, and optional key on the backend.
  - Add a Gemini Flash adapter with configurable model ID; verify supported image input at implementation time.
  - Tesseract becomes an optional adapter rather than the required primary provider.
  - Process extraction outside the main request path, with visible pending, failure, and retry states.
  - Suggest the final payable total, distinguishing subtotal, tax, service, tip, and cash tendered.
  - Require confirmation/correction before an expense enters financial totals.
  - Preserve manual fallback and editable drafts; never invent missing amounts.
  - Add optional extra tip only when it is not already included in the confirmed total.
  - Keep all weighted splitting and settlement calculations in exact application code, independent of AI responses.

- [ ] **Stage 3 — Automatically fall back from local AI to Gemini Flash**
  - Default to auto mode: local first, Gemini when local is unconfigured, unavailable, timed out, image-incompatible, or returns invalid extraction data.
  - Use bounded attempts and timeouts; avoid loops and duplicate expenses on retries/fallback.
  - Provide explicit local-only and Gemini-only modes; local-only must never send receipts to the cloud.
  - Show the provider used and sanitized fallback reason; try local again on later requests when available.
  - Preserve drafts and manual entry if both providers fail; distinguish rate limits/quota from credential errors.

- [ ] **Stage 3 — Add provider settings and secure API-key entry**
  - Support backend `RECEIPT_AI_MODE`, `LOCAL_AI_BASE_URL`, `LOCAL_AI_MODEL`, optional `LOCAL_AI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_KEY`, and a configurable bounded request timeout.
  - Document container-to-local-server connectivity; keep infrastructure endpoint changes restricted to the server operator.
  - When a needed cloud key is missing/invalid, show an authenticated provider/key prompt in the app, preserve the receipt, and retry after configuration.
  - Allow supported-provider selection, model/mode changes, connection testing, masked configured status, and credential replacement/removal.
  - Use environment credentials as defaults; explicitly saved organizer keys override only for that organizer, with removal restoring defaults.
  - Submit keys over HTTPS and encrypt saved credentials on the server with a separate server-only encryption secret.
  - Never expose keys in frontend bundles, browser persistence/caches, logs, exports, repository files, or API read responses; clear key input after submission.

- [ ] **Stage 3 — Verify provider switching, fallback, and key isolation**
  - Mock local success, local outage/timeout, unsupported image input, malformed extraction, Gemini success/failure, and local recovery.
  - Verify missing/revoked keys prompt for configuration; rate limits/quota produce useful errors without retry loops.
  - Verify local-only never calls Gemini, Gemini-only bypasses local, and fallback/retries cannot duplicate expenses.
  - Verify organizer-specific key precedence, environment defaults, masked responses, and authorization for provider settings.
  - Confirm identical allocation results regardless of extraction provider after user confirmation.

- [ ] **Stage 3 — Evaluate receipts and device capture**
  - Test representative real restaurant receipts, including blurry/skewed images and varied layouts.
  - Check included tax/service charges, subtotal versus total, and unreadable amounts.
  - Report observed extraction accuracy and failure cases; use synthetic fixtures for automated tests.
  - Verify receipt access isolation and document actual iPhone/Android camera checks.

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

- [x] ~~Stage 1 — Initialize the application: React/TS/Vite web, Node/TS API, PostgreSQL, Docker Compose, dev commands, `.env.example`, migrations, mobile layout; commands recorded in AGENTS.md~~ (2026-11-03) — Caveat: Docker Compose config is committed but not yet run; the dev Mac has no Docker engine.
- [x] ~~Stage 1 — Organizer authentication and ownership: register/login/logout, session cookie, ownership enforced server-side on every trip/participant/expense operation~~ (2026-11-03) — Verified with cross-organizer isolation checks (404s) and 401 without a session.
- [x] ~~Stage 1 — Trips and participants: name/dates/currency/status, positive integer default weights, archive instead of delete (archived people are refused on new expenses, history kept)~~ (2026-11-03)
- [x] ~~Stage 1 — Allocation engine: integer minor units with per-currency precision, exact BigInt proportional shares, largest-remainder leftovers with stable-order tie-breaker, allocations always sum to the amount~~ (2026-11-03) — 11 unit tests including the AGENTS.md examples.
- [x] ~~Stage 1 — Quick split: amount, currency, people, and weights without a trip; per-person shares plus copyable summary, reusing the shared engine in the browser~~ (2026-11-03) — API-level behavior verified; browser visual pass pending.
- [x] ~~Stage 1 — Manual trip expenses: description/date/category/confirmed total/one payer/included participants with weights; validation of amount, membership, and minimum inclusion; per-expense weight snapshots (default changes never rewrite past bills); edit and delete recalculate balances~~ (2026-11-03)
- [x] ~~Stage 1 — Trip overview and running balances: expense list, total spent, per-person paid/share/net; only confirmed expenses enter totals (drafts excluded at query level)~~ (2026-11-03) — Verified: 1:2:1 examples, 34/33/33 rounding, zero-sum balances.
- [x] ~~Document the staged implementation checklist and initialize project AGENTS.md~~ (2026-11-03)

- [x] ~~Document switchable local vision AI, automatic Gemini Flash fallback, and secure in-app API-key configuration~~ (2026-11-03)
