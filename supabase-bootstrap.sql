-- Foundational schema for a new PLENO Supabase project.
-- Apply this before the incremental feature scripts in this repository.
begin;

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 50),
  invite_code text not null unique check (invite_code ~ '^[A-F0-9]{8}$'),
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 30),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index if not exists league_members_by_user
  on public.league_members (user_id, joined_at);

create table if not exists public.league_matches (
  match_id bigint primary key,
  kickoff timestamptz not null,
  matchday smallint,
  status text,
  home_goals smallint,
  away_goals smallint
);

create table if not exists public.predictions (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id bigint not null,
  home_goals smallint not null check (home_goals between 0 and 99),
  away_goals smallint not null check (away_goals between 0 and 99),
  joker boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id, match_id),
  foreign key (league_id, user_id)
    references public.league_members(league_id, user_id) on delete cascade
);

create index if not exists predictions_by_league_match
  on public.predictions (league_id, match_id);

create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members member
    where member.league_id = p_league_id
      and member.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_league_member(uuid) from public, anon;
grant execute on function public.is_league_member(uuid) to authenticated, service_role;

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_matches enable row level security;
alter table public.predictions enable row level security;

revoke all on public.leagues, public.league_members, public.league_matches, public.predictions
  from public, anon, authenticated;
grant select on public.leagues, public.league_members to authenticated;
grant select on public.league_matches to authenticated;
grant select, insert, update on public.predictions to authenticated;
grant all on public.leagues, public.league_members, public.league_matches, public.predictions
  to service_role;

drop policy if exists "League members read their leagues" on public.leagues;
create policy "League members read their leagues"
  on public.leagues for select to authenticated
  using (public.is_league_member(id));

drop policy if exists "Members read their league rosters" on public.league_members;
create policy "Members read their league rosters"
  on public.league_members for select to authenticated
  using (public.is_league_member(league_id));

drop policy if exists "Authenticated users read fixtures" on public.league_matches;
create policy "Authenticated users read fixtures"
  on public.league_matches for select to authenticated
  using (true);

drop policy if exists "Members read predictions after kickoff" on public.predictions;
create policy "Members read predictions after kickoff"
  on public.predictions for select to authenticated
  using (
    public.is_league_member(league_id)
    and (
      user_id = (select auth.uid())
      or exists (
        select 1
        from public.league_matches fixture
        where fixture.match_id = predictions.match_id
          and fixture.kickoff <= now()
      )
    )
  );

drop policy if exists "Members save their own predictions before kickoff" on public.predictions;
create policy "Members save their own predictions before kickoff"
  on public.predictions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_league_member(league_id)
    and not exists (
      select 1
      from public.league_matches fixture
      where fixture.match_id = predictions.match_id
        and fixture.kickoff <= now()
    )
  );

drop policy if exists "Members update their own predictions before kickoff" on public.predictions;
create policy "Members update their own predictions before kickoff"
  on public.predictions for update to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_league_member(league_id)
    and not exists (
      select 1
      from public.league_matches fixture
      where fixture.match_id = predictions.match_id
        and fixture.kickoff <= now()
    )
  )
  with check (
    user_id = (select auth.uid())
    and public.is_league_member(league_id)
    and not exists (
      select 1
      from public.league_matches fixture
      where fixture.match_id = predictions.match_id
        and fixture.kickoff <= now()
    )
  );

create or replace function public.create_league(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  v_display_name text := regexp_replace(btrim(coalesce(p_display_name, '')), '[[:space:]]+', ' ', 'g');
  v_invite_code text;
  v_league_id uuid;
  v_attempt integer;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if char_length(v_name) not between 1 and 50 then
    raise exception 'League name must contain 1 to 50 characters';
  end if;
  if char_length(v_display_name) not between 1 and 30 then
    raise exception 'Display name must contain 1 to 30 characters';
  end if;

  for v_attempt in 1..5 loop
    v_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.leagues (name, invite_code, owner_id)
    values (v_name, v_invite_code, v_user_id)
    on conflict (invite_code) do nothing
    returning id into v_league_id;
    exit when v_league_id is not null;
  end loop;

  if v_league_id is null then
    raise exception 'Could not generate a unique league invitation code';
  end if;

  insert into public.league_members (league_id, user_id, display_name)
  values (v_league_id, v_user_id, v_display_name);
  return v_league_id;
end;
$$;

create or replace function public.join_league(p_invite_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_display_name text := regexp_replace(btrim(coalesce(p_display_name, '')), '[[:space:]]+', ' ', 'g');
  v_league_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if char_length(v_display_name) not between 1 and 30 then
    raise exception 'Display name must contain 1 to 30 characters';
  end if;

  select league.id into v_league_id
  from public.leagues league
  where league.invite_code = upper(btrim(coalesce(p_invite_code, '')))
  for update;
  if v_league_id is null then
    raise exception 'League invitation code not found';
  end if;

  insert into public.league_members (league_id, user_id, display_name)
  values (v_league_id, v_user_id, v_display_name)
  on conflict (league_id, user_id) do update
    set display_name = excluded.display_name;
  return v_league_id;
end;
$$;

create or replace function public.update_league_display_name(
  p_league_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_display_name text := regexp_replace(btrim(coalesce(p_display_name, '')), '[[:space:]]+', ' ', 'g');
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if char_length(v_display_name) not between 1 and 30 then
    raise exception 'Display name must contain 1 to 30 characters';
  end if;

  update public.league_members
  set display_name = v_display_name
  where league_id = p_league_id
    and user_id = v_user_id;
  if not found then
    raise exception 'League membership not found';
  end if;
end;
$$;

revoke all on function public.create_league(text, text) from public, anon, authenticated;
revoke all on function public.join_league(text, text) from public, anon, authenticated;
revoke all on function public.update_league_display_name(uuid, text) from public, anon, authenticated;
grant execute on function public.create_league(text, text) to authenticated;
grant execute on function public.join_league(text, text) to authenticated;
grant execute on function public.update_league_display_name(uuid, text) to authenticated;

commit;
