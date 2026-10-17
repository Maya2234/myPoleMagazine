-- Community activity: public dancers adding a move to Current goals, or marking one achieved.
-- Run after media.sql (account_is_public) and current-goals.sql (categories.is_default). Repeatable.

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('goal', 'achieved')),
  move_id uuid not null references public.moves (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists activity_created_idx on public.activity (created_at desc);

grant select on public.activity to authenticated;
alter table public.activity enable row level security;

drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using (user_id = auth.uid() or public.account_is_public(user_id));

create or replace function public.record_goal_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  is_goals boolean;
begin
  select m.user_id into owner from public.moves m where m.id = new.move_id;
  select c.is_default into is_goals from public.categories c where c.id = new.category_id;
  if coalesce(is_goals, false) and public.account_is_public(owner) then
    insert into public.activity (user_id, kind, move_id) values (owner, 'goal', new.move_id);
  end if;
  return new;
end $$;

drop trigger if exists activity_goal on public.move_categories;
create trigger activity_goal
  after insert on public.move_categories
  for each row execute function public.record_goal_activity();

create or replace function public.record_achieved_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'achieved' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'achieved' then return new; end if;
  if public.account_is_public(new.user_id) then
    insert into public.activity (user_id, kind, move_id) values (new.user_id, 'achieved', new.id);
  end if;
  return new;
end $$;

drop trigger if exists activity_achieved on public.moves;
create trigger activity_achieved
  after insert or update of status on public.moves
  for each row execute function public.record_achieved_activity();
