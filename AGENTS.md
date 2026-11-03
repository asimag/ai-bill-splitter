# Bill Splitter — Agent Instructions

## Purpose and current state

Build a self-hosted, mobile-first PWA for weighted restaurant bill splitting and multi-expense trips. Users capture receipts, confirm amounts, track who paid, and settle balances.

The Stage 1 application is implemented and verified locally (2026-11-03), Stage 2 (settlement suggestions, repayments with corrections/reversals, and automated API/integration tests) is implemented and verified locally (2026-11-03), and Stage 3 (private receipt capture/storage, switchable local/Gemini vision extraction with automatic fallback, secure in-app key settings, mocked + live verification) is implemented and verified locally (2026-11-03). Remaining: the Stage 3 real-receipt/real-device evaluation pass, then Stages 4-5. See [TASKS.md](TASKS.md).

Use [TASKS.md](TASKS.md) as the implementation checklist. Work in stage order, update completed items with dates, and report what was verified. Do not mark an entire stage complete when acceptance checks remain outstanding.

## Repository structure and commands (real, verified 2026-11-03)

npm-workspaces monorepo (Node ≥ 22):

- `packages/core` — `@billsplit/core`: exact-integer money parsing/formatting and the allocation engine. Shared by API and browser; tests in `packages/core/test` cover the AGENTS.md money examples (vitest).
- `apps/server` — `@billsplit/server`: Express + `pg` API (TypeScript run with `tsx`, no build step; multipart receipt uploads via `multer`, in memory + content sniffing). SQL migrations in `apps/server/migrations` (applied by `npm run migrate` and automatically at server startup). Env loaded from repo-root `.env`. Stage 3 layout: `src/ai/` (adapter interface `types.ts`, output validation `validate.ts`, error sanitizing/classification `errors.ts`, shared extraction prompt `prompt.ts`, adapters `local.ts`/`gemini.ts`/`tesseract.ts`, orchestrator + settings `service.ts`), `src/storage.ts` (private file storage + magic-byte sniffing), `src/crypto.ts` (AES-256-GCM key encryption), `src/routes/receipts.ts`, `src/routes/ai.ts`. Receipt files live under `receipts-storage/` at the repo root by default (`RECEIPT_STORAGE_DIR`; mounted at `/data/receipts` in Docker) — gitignored, never statically served. Stage-3 integration tests use their own DB `billsplit_test_s3` (parallel-safe with Stage 2's `billsplit_test`).
- `apps/web` — `@billsplit/web`: Vite + React + react-router mobile-first UI; dev server proxies `/api` to :8787.
- `docker-compose.yml` + per-app Dockerfiles — Postgres + API + nginx-served web. **Not yet run**: the dev Mac has no Docker engine; verify `docker compose up` on the target server.

Commands (run from the repo root):

```bash
npm install                        # once
cp .env.example .env               # set SESSION_SECRET and CREDENTIALS_SECRET: openssl rand -hex 32 (each)
npm run migrate                    # apply pending SQL migrations
npm run dev                        # API :8787 + web :5173 together (also `npm run dev -w @billsplit/server|web` separately)
npm test                           # workspace tests: 17 core engine tests + 33 server tests (12 AI/extraction
                                   #  unit, 9 Stage-2 API integration, 12 Stage-3 receipt/AI integration)
                                   #  (integration tests need the local Postgres on :5433 and auto-create
                                   #  billsplit_test and billsplit_test_s3; override with TEST_DATABASE_URL
                                   #  / TEST_DATABASE_URL_STAGE3)
npm run typecheck                  # tsc --noEmit in all workspaces
npm run build -w @billsplit/web    # production web bundle -> apps/web/dist
bash scripts/e2e-stage3.sh [png]   # live Stage-3 smoke test against a running dev API: register -> trip ->
                                   #  upload receipt -> poll real-model extraction -> confirm expense (+tip)
                                   #  -> balances -> duplicate-attach 409 -> foreign-organizer 404s -> masked settings
```

Local dev database: PostgreSQL 18.4 (DBngin binaries at `/Users/Shared/DBngin/postgresql/18.4_arm/bin`), cluster at `~/pgdata/bill-splitter-dev`, port 5433. Start if down:

```bash
/Users/Shared/DBngin/postgresql/18.4_arm/bin/pg_ctl -D ~/pgdata/bill-splitter-dev -o "-p 5433" -l ~/pgdata/bill-splitter-dev/server.log start
```

Stage 1 API behavior was verified with a 35-assertion curl script (auth, ownership/isolation, allocation examples, rounding, weight snapshots, archive, currency precision, cascade deletes). Stage 2 added automated API integration tests in `apps/server/test/api.test.ts` (vitest + real Express app + real PostgreSQL `billsplit_test` DB, created automatically): financial examples end-to-end, repayment record/reverse/restore/correct without double-counting, suggestions, validation, precision, and organizer isolation. Express app construction lives in `apps/server/src/app.ts` (`createApp()`) so tests can mount it without binding a port.

Stage 3 was verified two ways: (1) automated — `apps/server/test/receipts.test.ts` runs the real app against `billsplit_test_s3` with mocked adapters (`setAdaptersForTesting`) covering the full fallback matrix, confirmation idempotency, upload validation, receipt authorization/isolation, and masked/encrypted key handling; `apps/server/test/ai.test.ts` covers the extraction boundary (envelope/amount/date validation, error classification/sanitizing, AES-GCM round-trip, Tesseract heuristic). (2) live — `scripts/e2e-stage3.sh` against the dev server with the real local vision model (`.env`: `LOCAL_AI_BASE_URL=http://127.0.0.1:11234/v1`, model `ddalcu/Qwen3.8-Flash-Next-MLX-Serve-iQ-MLX-4.7bpw`, key from env): a synthetic rendered restaurant receipt extracted perfectly (merchant/date/USD/subtotal 34.00/tax 1.70/service 3.40/tip 2.90/total 42.00/cash 50.00 — included charges never re-added), then confirm+tip produced exact 45.00 → 2250/2250 allocations with zero-sum balances, duplicate attach refused 409, foreign organizer got 404s, and settings responses contained no key material. A live outage drill (local endpoint down, no Gemini key) preserved the receipt with a sanitized trace and actionable credentials error. Not yet done: real photographed receipts, real Gemini API call, iPhone/Android camera checks, and a browser visual pass of the new UI.

## Technology and scope

- Frontend: React, TypeScript, and Vite, with a mobile-first interface and PWA support.
- Backend: Node.js and TypeScript with PostgreSQL persistence.
- Receipt recognition: switchable backend vision-AI adapters, preferring the user's local image-capable AI and automatically falling back to Gemini Flash. Tesseract is an optional additional adapter, not the required primary provider.
- Receipt files: private persistent storage, initially a server directory outside the public web root.
- Offline drafts: IndexedDB, introduced after the online manual/OCR workflows work.
- Deployment: Docker Compose on the user's server, with HTTPS and persistent volumes.
- First release: authenticated organizer manages trips; participants are named people without accounts.
- One currency per trip, one payer per expense, positive integer weights, and positive expense amounts.
- Keep quick split available without requiring a trip.
- Defer collaborative editing, currency conversion, multiple payers, refunds, item-level splitting, native apps, and payment integration unless requested.

## Suggested domain model

- Organizer: authenticated owner of trips and private receipt data.
- Trip: owner, name, optional dates, currency, open/closed status, participants.
- Participant: trip membership, display name, default weight, archived status.
- Expense: trip, description, date, category, confirmed total, payer, draft/confirmed state, optional receipt.
- Expense allocation: participant, snapshotted weight, allocated minor units, stable ordering for rounding.
- Receipt: private storage reference, processing state, suggested total, and confirmation state.
- AI configuration: local endpoint/model, Gemini model, extraction mode, and organizer-scoped encrypted credentials or server environment references; never return secret values through read APIs.
- Repayment: trip, sender, recipient, amount, date, correction/reversal information.
- Offline submission: stable ID used to deduplicate retried expense submissions.

Final schema names may follow the chosen project conventions. Preserve these relationships and invariants.

## Financial invariants

1. Store monetary values in integer minor units with explicit currency precision. Avoid floating-point money arithmetic and unsafe integer conversions.
2. Compute each share as total × weight / sum of included weights, using exact arithmetic.
3. Distribute rounding leftovers by largest fractional remainder. Use stable participant order for ties and preserve it on saved expenses.
4. Every confirmed expense's allocations must sum exactly to its amount.
5. Require at least one included participant and positive weights. Excluded participants receive no allocation; the payer may be excluded from sharing.
6. Snapshot weights on each expense. Updating trip defaults affects new expenses only unless the user explicitly edits an existing expense.
7. Validate that payer, allocation participants, and repayment participants belong to the same trip; never mix currencies.
8. Compute net balance as: expenses paid - allocated shares + repayments sent - repayments received. Positive means money to receive; negative means money owed.
9. Trip net balances must sum to zero. Suggested transfers do not change balances; recorded repayments do.
10. Keep repayments separate from expense totals. Correct or reverse them without counting them twice.
11. Recompute affected balances after expense edits/deletions or repayment corrections. Prefer deriving balances over maintaining duplicate mutable totals.
12. Ignore unconfirmed drafts and OCR suggestions in all financial totals. Closing a trip does not settle debts.

## Receipt and offline behavior

- Always support manual entry and correction. OCR suggests amounts; the user confirms them.
- Distinguish final payable total from subtotal, tax, service charges, tip, and cash tendered. Never add included charges twice.
- Support camera/photo upload, preview, rotation, and retaking; validate file type/content and size.
- Authorize every receipt read and write. Do not expose uploaded files through a public static directory.
- Keep OCR outside the main request path and separate from allocation logic; show pending, failure, and retry states.
- Persist new offline drafts and images across reloads. Clearly label local-only data and storage errors.
- Retry uploads when the app is open and connectivity returns; background sync is optional.
- Use stable submission IDs, server idempotency, and atomic expense/allocation writes to prevent duplicate or partial records.
- Revalidate membership and trip status when a queued draft reaches the server. Preserve rejected drafts for correction.
- Isolate cached private data by organizer and clear it appropriately on logout. Do not indiscriminately cache authenticated API responses.
- State clearly that local drafts are not backed up until uploaded.

## AI providers, fallback, and credentials

- Receipt AI extracts structured receipt data only. Exact application code computes all shares and balances after user confirmation; never trust AI-generated split arithmetic.
- Define one receipt-extraction interface and normalized, runtime-validated output: merchant/date when available, currency, subtotal, tax/service/tip when identifiable, total payable as a decimal string, and uncertainty/warnings. Missing fields are null, not guessed. Validate currency/amount before conversion into minor units.
- Treat receipt text and model output as untrusted data, not instructions or executable content.
- Implement an OpenAI-compatible image-input adapter for the local server, without requiring an OpenAI account or cloud key. Keep other local protocols replaceable through the adapter boundary.
- Configure the local base URL, model ID, and optional API key on the backend. The endpoint must be reachable from the deployed backend/container, not merely from the user's phone; localhost inside Docker refers to that container.
- Implemented settings (2026-11-03): `RECEIPT_AI_MODE=auto|local|gemini|tesseract`, `LOCAL_AI_BASE_URL`, `LOCAL_AI_MODEL`, optional `LOCAL_AI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.6-flash` — verified stable + image-capable 2026-11-03; `gemini-2.5-flash` is deprecated/shutting down), `GEMINI_API_KEY`, `RECEIPT_AI_TIMEOUT_MS`, plus `CREDENTIALS_SECRET` (encrypts saved organizer keys), `RECEIPT_STORAGE_DIR`, and `RECEIPT_MAX_BYTES`.
- Default to auto mode: try local first; if missing, unreachable, timed out, image-incompatible, or returning unusable/invalid structured data after a bounded attempt, automatically try Gemini Flash when configured. Record a sanitized fallback reason. Do not add an approval dialog before this user-authorized fallback.
- In local-only mode, keep processing local and show retry/manual entry on failure. In Gemini-only mode, use Gemini directly. Never silently send to a third provider.
- Keep the Gemini Flash model ID configurable and verify a currently supported image-capable Flash model when implementing. Do not hardcode a model version into business logic.
- If fallback needs a Gemini key and none is configured, preserve the draft and show an authenticated in-app prompt: select the supported provider, paste its API key, test/save, and retry. Do not ask for keys in chat. Invalid/revoked keys should lead to this same settings flow; rate limits and exhausted quota should show actionable errors rather than endless key prompts or retries.
- Provide provider settings with mode/model selection, test connection, masked configured status, and replace/remove credential actions. Restrict infrastructure endpoint changes to the server operator. Show which provider processed a receipt and when cloud fallback occurred.
- Treat environment credentials as server defaults. An explicitly saved organizer credential overrides the default for that organizer only; removing it restores the default. Never expose environment credentials to the UI or use one organizer's saved key for another organizer.
- Send browser-entered keys to the backend over HTTPS. Store saved keys encrypted at rest using a server-only secret; keep encryption keys out of the database. Never place provider keys in frontend bundles, browser persistence/service-worker caches, logs, exports, source control, or ordinary API read responses. Clear key-entry fields after submission.
- Bound retries and timeouts for both providers; avoid fallback loops and preserve manual entry if neither succeeds. Unclear but valid extraction requires user review, not invented amounts. Reprocessing/fallback must not create duplicate expenses.
- Verify automatic local-to-Gemini fallback, missing/invalid credentials, settings isolation, malformed responses, timeout/rate-limit behavior, no-cloud local-only mode, and recovery on later requests when local AI becomes available again. Use mocked adapters in automated tests and real provider calls only when credentials are available.
- Provider references: [Gemini image input](https://ai.google.dev/gemini-api/docs/image-understanding) and [server-side key handling](https://ai.google.dev/gemini-api/docs/api-key).

## Delivery order and acceptance

1. Manual quick split, organizer authentication, trips, participants, expenses, and running balances.
2. Transfer suggestions, repayments, and focused financial tests.
3. Private receipt capture, switchable local/Gemini vision extraction, secure key settings, automatic fallback, confirmation, and real-receipt evaluation.
4. Installable PWA, offline drafts, and safe upload retries.
5. Trip closing/reopening, exports, mobile polish, deployment, backups, and end-to-end verification.

Key examples:

- 6,000 split at 1:2:1 gives 1,500 / 3,000 / 1,500.
- Across 9,000 of expenses at 1:2:1, Ali pays 6,000, Sara pays 3,000, and Ahmed pays zero. Their shares are 2,250 / 4,500 / 2,250. Sara owes Ali 1,500; Ahmed owes Ali 2,250.
- 100 minor units split equally among three people gives 34 / 33 / 33 using stable participant order.

## Working practices

- Inspect existing code and applicable instructions before edits; reuse suitable dependencies and patterns.
- Keep allocation and settlement logic independent from UI, OCR, and persistence details.
- Choose the smallest implementation that completes the current stage. Avoid speculative infrastructure.
- Enforce organizer ownership in the backend, not just by hiding UI controls.
- Use migrations for schema changes, validate API inputs, and make related writes transactional.
- Never commit secrets, real private receipts, personal account details, or production data. Use synthetic fixtures and placeholder environment values.
- Add meaningful tests for financial invariants, authorization, and retry behavior. Verify changed behavior without duplicating implementation details in tests.
- Record actual setup/build/test commands here after scaffolding; do not claim unavailable commands passed.
- Distinguish automated checks from real-device tests and report limitations honestly.
- Keep TASKS.md aligned with completed work. Do not introduce new features solely because they appear under Someday.
- Prepare reviewable deployment configuration when requested; publish or deploy only when authorized by the user.
