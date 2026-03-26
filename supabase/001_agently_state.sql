create table if not exists public.agently_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.agently_state (id, payload)
values ('primary', '{}'::jsonb)
on conflict (id) do nothing;
