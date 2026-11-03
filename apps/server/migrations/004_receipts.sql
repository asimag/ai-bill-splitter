-- Stage 3: private receipts, extraction results, and organizer-scoped AI settings.
-- Receipt files themselves live on private disk; only a storage key is stored here.

create table receipt (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trip (id) on delete cascade,
  organizer_id uuid not null references organizer (id) on delete cascade,
  original_name text,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  -- Relative path under the private storage dir; never served statically.
  storage_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'extracted', 'failed', 'confirmed')),
  -- Which provider produced `extraction`, and a sanitized trace of fallback.
  provider_used text,
  fallback_reason text,
  error_kind text
    check (error_kind in ('credentials', 'rate_limit', 'unavailable', 'timeout', 'image', 'invalid', 'internal')),
  processing_error text,
  -- Validated structured extraction (merchant/date/amounts as decimal strings).
  -- Never enters financial totals until the organizer confirms an expense.
  extraction jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index receipt_trip_idx on receipt (trip_id);
create index receipt_organizer_idx on receipt (organizer_id);

-- One expense per receipt at most; the unique index also makes retried
-- "confirm" submissions idempotent-fail (409) instead of duplicating expenses.
alter table expense add column receipt_id uuid unique references receipt (id) on delete set null;

-- Organizer-scoped AI preferences. Keys are stored AES-256-GCM encrypted with
-- a server-only CREDENTIALS_SECRET; plaintext keys never touch the database.
-- The local endpoint/model stays server-operator configuration (env only).
create table organizer_ai_setting (
  organizer_id uuid primary key references organizer (id) on delete cascade,
  mode text check (mode in ('auto', 'local', 'gemini', 'tesseract')),
  gemini_model text check (length(btrim(gemini_model)) between 1 and 80),
  gemini_key_encrypted text,
  updated_at timestamptz not null default now()
);
