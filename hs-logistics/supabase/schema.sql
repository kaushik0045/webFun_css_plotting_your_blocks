-- HS Logistics — dispatch & driver tracking schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Design notes
--  * The broker RATE is never stored anywhere. Rate confirmations are parsed in the
--    dispatcher's browser and only stop details (addresses, appointments, PU numbers)
--    are saved. The PDF itself is not uploaded.
--  * Drivers can only read their own loads/stops and only write their own locations.
--  * Every GPS point goes into location_history; a trigger keeps driver_locations
--    (one row per driver = latest position) up to date for the live map.

create extension if not exists pgcrypto;

-- ───────────────────────── profiles ─────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  phone         text,
  truck_number  text,
  role          text not null default 'driver' check (role in ('dispatcher', 'driver')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create or replace function public.is_dispatcher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'dispatcher');
$$;

-- New sign-ups become drivers. Promote the first dispatcher by hand:
--   update public.profiles set role = 'dispatcher' where id = (select id from auth.users where email = 'you@example.com');
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Drivers may edit their name/phone/truck but never their role or active flag.
-- Runs as the caller (not security definer) so current_user tells app users apart from
-- the SQL editor / service role, which are trusted.
create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_dispatcher() and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'Only a dispatcher can change role or active status';
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ───────────────────────── loads & stops ─────────────────────────
create table if not exists public.loads (
  id            uuid primary key default gen_random_uuid(),
  load_number   text,                 -- broker load / order number
  broker_name   text,
  driver_id     uuid references public.profiles(id) on delete set null,
  status        text not null default 'assigned'
                check (status in ('draft', 'assigned', 'in_transit', 'delivered', 'cancelled')),
  driver_notes  text,                 -- instructions visible to the driver (never put the rate here)
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.stops (
  id             uuid primary key default gen_random_uuid(),
  load_id        uuid not null references public.loads(id) on delete cascade,
  seq            int  not null,
  type           text not null check (type in ('pickup', 'delivery')),
  facility_name  text,
  address        text,                -- full street address, one line
  appointment    text,                -- as written on the rate con, e.g. "11/12/2026 08:00-14:00" or "FCFS"
  pickup_number  text,                -- PU# / delivery # / PO / reference numbers
  status         text not null default 'pending' check (status in ('pending', 'arrived', 'departed')),
  arrived_at     timestamptz,
  departed_at    timestamptz,
  unique (load_id, seq) deferrable initially deferred   -- lets the dashboard reorder stops in one save
);

create index if not exists loads_driver_idx on public.loads(driver_id, status);
create index if not exists stops_load_idx on public.stops(load_id, seq);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists loads_touch on public.loads;
create trigger loads_touch before update on public.loads
  for each row execute function public.touch_updated_at();

-- Drivers may only change stop status/timestamps, not addresses or numbers.
-- Runs as the caller (not security definer) so current_user tells app users apart from
-- the SQL editor / service role, which are trusted.
create or replace function public.guard_stop_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_dispatcher() and (
       new.load_id is distinct from old.load_id or new.seq is distinct from old.seq
    or new.type is distinct from old.type or new.facility_name is distinct from old.facility_name
    or new.address is distinct from old.address or new.appointment is distinct from old.appointment
    or new.pickup_number is distinct from old.pickup_number) then
    raise exception 'Drivers can only update stop status';
  end if;
  return new;
end $$;
drop trigger if exists guard_stop_update on public.stops;
create trigger guard_stop_update before update on public.stops
  for each row execute function public.guard_stop_update();

-- Drivers may only move a load to in_transit / delivered.
-- Runs as the caller (not security definer) so current_user tells app users apart from
-- the SQL editor / service role, which are trusted.
create or replace function public.guard_load_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_dispatcher() and (
       new.driver_id is distinct from old.driver_id or new.load_number is distinct from old.load_number
    or new.broker_name is distinct from old.broker_name or new.driver_notes is distinct from old.driver_notes
    or new.status not in ('in_transit', 'delivered')) then
    raise exception 'Drivers can only update load status to in_transit or delivered';
  end if;
  return new;
end $$;
drop trigger if exists guard_load_update on public.loads;
create trigger guard_load_update before update on public.loads
  for each row execute function public.guard_load_update();

-- ───────────────────────── locations ─────────────────────────
create table if not exists public.location_history (
  id           bigint generated always as identity primary key,
  driver_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  lat          double precision not null,
  lng          double precision not null,
  speed_mps    double precision,
  heading      double precision,
  accuracy_m   double precision,
  battery      double precision,
  recorded_at  timestamptz not null,
  received_at  timestamptz not null default now()
);
create index if not exists location_history_driver_time_idx on public.location_history(driver_id, recorded_at desc);

create table if not exists public.driver_locations (
  driver_id    uuid primary key references public.profiles(id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  speed_mps    double precision,
  heading      double precision,
  accuracy_m   double precision,
  battery      double precision,
  recorded_at  timestamptz not null,
  tracking_on  boolean not null default true
);

create or replace function public.update_latest_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.driver_locations as d (driver_id, lat, lng, speed_mps, heading, accuracy_m, battery, recorded_at, tracking_on)
  values (new.driver_id, new.lat, new.lng, new.speed_mps, new.heading, new.accuracy_m, new.battery, new.recorded_at, true)
  on conflict (driver_id) do update set
    lat = excluded.lat, lng = excluded.lng, speed_mps = excluded.speed_mps, heading = excluded.heading,
    accuracy_m = excluded.accuracy_m, battery = excluded.battery, recorded_at = excluded.recorded_at,
    tracking_on = true
  where d.recorded_at <= excluded.recorded_at;   -- ignore late-arriving offline points
  return new;
end $$;
drop trigger if exists location_history_latest on public.location_history;
create trigger location_history_latest after insert on public.location_history
  for each row execute function public.update_latest_location();

-- Driver app calls this when the driver turns tracking off (so the map shows why they went quiet).
create or replace function public.set_tracking(p_on boolean)
returns void language sql security definer set search_path = public as $$
  update public.driver_locations set tracking_on = p_on where driver_id = auth.uid();
$$;

-- ───────────────────────── row level security ─────────────────────────
alter table public.profiles         enable row level security;
alter table public.loads            enable row level security;
alter table public.stops            enable row level security;
alter table public.location_history enable row level security;
alter table public.driver_locations enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_dispatcher());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid() or public.is_dispatcher());

drop policy if exists loads_dispatcher on public.loads;
create policy loads_dispatcher on public.loads for all using (public.is_dispatcher()) with check (public.is_dispatcher());
drop policy if exists loads_driver_read on public.loads;
create policy loads_driver_read on public.loads for select using (driver_id = auth.uid() and status <> 'draft');
drop policy if exists loads_driver_update on public.loads;
create policy loads_driver_update on public.loads for update using (driver_id = auth.uid()) with check (driver_id = auth.uid());

drop policy if exists stops_dispatcher on public.stops;
create policy stops_dispatcher on public.stops for all using (public.is_dispatcher()) with check (public.is_dispatcher());
drop policy if exists stops_driver_read on public.stops;
create policy stops_driver_read on public.stops for select
  using (exists (select 1 from public.loads l where l.id = load_id and l.driver_id = auth.uid() and l.status <> 'draft'));
drop policy if exists stops_driver_update on public.stops;
create policy stops_driver_update on public.stops for update
  using (exists (select 1 from public.loads l where l.id = load_id and l.driver_id = auth.uid()));

drop policy if exists history_insert_own on public.location_history;
create policy history_insert_own on public.location_history for insert with check (driver_id = auth.uid());
drop policy if exists history_read on public.location_history;
create policy history_read on public.location_history for select using (driver_id = auth.uid() or public.is_dispatcher());

drop policy if exists latest_read on public.driver_locations;
create policy latest_read on public.driver_locations for select using (driver_id = auth.uid() or public.is_dispatcher());

-- ───────────────────────── realtime ─────────────────────────
-- Live map + load board update instantly.
do $$
begin
  begin alter publication supabase_realtime add table public.driver_locations; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.loads;            exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.stops;            exception when duplicate_object then null; end;
end $$;
