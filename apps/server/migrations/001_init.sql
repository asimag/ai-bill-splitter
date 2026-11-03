-- Stage 1: organizers, trips, participants, expenses with weight snapshots.
-- Money is stored only in integer minor units.

create table organizer (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table trip (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references organizer (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  start_date date,
  end_date date,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create index trip_organizer_idx on trip (organizer_id);

create table participant (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trip (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  default_weight integer not null check (default_weight > 0),
  archived boolean not null default false,
  position integer not null,
  created_at timestamptz not null default now()
);

create index participant_trip_idx on participant (trip_id);

create table expense (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trip (id) on delete cascade,
  description text not null check (length(btrim(description)) between 1 and 200),
  expense_date date not null default current_date,
  category text,
  amount_minor bigint not null check (amount_minor > 0),
  payer_participant_id uuid not null references participant (id),
  status text not null default 'confirmed' check (status in ('draft', 'confirmed')),
  -- Stable client id used later to make retried (offline) submissions idempotent.
  submission_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expense_trip_idx on expense (trip_id);

-- Weight and share are snapshotted per expense; changing participant
-- defaults later must never rewrite these rows.
create table expense_allocation (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expense (id) on delete cascade,
  participant_id uuid not null references participant (id),
  weight integer not null check (weight > 0),
  amount_minor bigint not null check (amount_minor >= 0),
  position integer not null,
  unique (expense_id, participant_id)
);

create index expense_allocation_expense_idx on expense_allocation (expense_id);
