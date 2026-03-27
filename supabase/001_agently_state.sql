create table if not exists public.agently_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.agently_state
  alter column payload set default '{}'::jsonb;

alter table public.agently_state
  add column if not exists created_at timestamptz not null default timezone('utc', now());

alter table public.agently_state
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.agently_state
set payload = '{}'::jsonb
where jsonb_typeof(payload) is distinct from 'object';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agently_state_payload_is_object'
      and conrelid = 'public.agently_state'::regclass
  ) then
    alter table public.agently_state
      add constraint agently_state_payload_is_object
      check (jsonb_typeof(payload) = 'object');
  end if;
end
$$;

create index if not exists agently_state_updated_at_idx
  on public.agently_state (updated_at desc);

create or replace function public.set_agently_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists agently_state_set_updated_at on public.agently_state;

create trigger agently_state_set_updated_at
before update on public.agently_state
for each row
execute function public.set_agently_state_updated_at();

alter table public.agently_state enable row level security;

revoke all on public.agently_state from anon;
revoke all on public.agently_state from authenticated;
grant select, insert, update, delete on public.agently_state to service_role;

comment on table public.agently_state is 'Workspace-level JSON state store used by the Agently backend.';
