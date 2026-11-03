-- Optional record of HOW a bill was paid (card/cash/...); advisory only,
-- it never affects allocations or balances.
alter table expense
  add column payment_method text
  check (payment_method in ('cash', 'card', 'transfer', 'other'));
