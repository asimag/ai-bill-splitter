-- Deleting a trip must remove its expenses and allocations in one cascade;
-- the participant FKs therefore need ON DELETE CASCADE as well.

alter table expense
  drop constraint expense_payer_participant_id_fkey,
  add constraint expense_payer_participant_id_fkey
    foreign key (payer_participant_id) references participant (id) on delete cascade;

alter table expense_allocation
  drop constraint expense_allocation_participant_id_fkey,
  add constraint expense_allocation_participant_id_fkey
    foreign key (participant_id) references participant (id) on delete cascade;
