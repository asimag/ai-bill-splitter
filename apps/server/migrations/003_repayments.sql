-- Stage 2: repayments between participants, stored separately from expenses.
-- Net balance = expenses paid - allocated shares + repayments sent
--                - repayments received, counting only status = 'recorded'.
-- A reversal flips the original row's status (it stays for history) instead
-- of deleting it, so the transfer is never counted twice or lost.

create table repayment (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trip (id) on delete cascade,
  sender_participant_id uuid not null references participant (id) on delete cascade,
  recipient_participant_id uuid not null references participant (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  repayment_date date not null default current_date,
  note text,
  status text not null default 'recorded' check (status in ('recorded', 'reversed')),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_participant_id <> recipient_participant_id)
);

create index repayment_trip_idx on repayment (trip_id);
