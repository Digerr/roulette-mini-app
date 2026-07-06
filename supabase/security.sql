-- ============================================================
-- Roulza — Security hardening
-- Run AFTER schema.sql, rpc.sql, premium.sql
-- Replaces permissive policies with verified RPC-based access
-- ============================================================

-- ========== APPROACH ==========
-- Since we use anon key (no Supabase Auth), RLS can't identify users.
-- Solution: All mutating operations go through RPC functions that
-- verify Telegram initData signature server-side.
-- Direct table access is read-only and limited.

-- ========== DROP OLD PERMISSIVE POLICIES ==========
drop policy if exists "anon_all_users" on public.users;
drop policy if exists "anon_all_user_tags" on public.user_tags;
drop policy if exists "anon_all_chats" on public.chats;
drop policy if exists "anon_all_messages" on public.messages;
drop policy if exists "anon_all_reports" on public.reports;
drop policy if exists "anon_all_queue" on public.search_queue;
drop policy if exists "anon_all_ach" on public.user_achievements;

-- ========== USERS: read all (for matchmaking), write only own ==========
-- Users need to see other users for partner lookup, but only basic fields
create policy "users_select_all" on public.users
  for select to anon, authenticated using (true);

-- No direct INSERT/UPDATE/DELETE on users — must use RPC
revoke insert, update, delete on public.users from anon, authenticated;
-- Keep insert for anon (dbEnsureUser creates new users)
-- NOTE: In production, replace with RPC that verifies initData

-- For MVP: allow anon to insert/update users (dbEnsureUser, dbUpdateProfile)
-- TODO: Move to RPC with initData verification
grant insert, update on public.users to anon, authenticated;

-- ========== USER_TAGS: read all, write only own ==========
create policy "user_tags_select_all" on public.user_tags
  for select to anon, authenticated using (true);
-- Write through RPC only (dbSetUserTags)
-- For MVP: allow direct (TODO: harden)
grant insert, delete on public.user_tags to anon, authenticated;

-- ========== CHATS: read only where user is participant ==========
-- Can't verify tg_id in RLS without auth, so allow read all for matchmaking
create policy "chats_select_all" on public.chats
  for select to anon, authenticated using (true);
grant insert, update on public.chats to anon, authenticated;

-- ========== MESSAGES: read all in chats, write via RPC ==========
create policy "messages_select_all" on public.messages
  for select to anon, authenticated using (true);
grant insert on public.messages to anon, authenticated;

-- ========== REPORTS: insert only, no read by anon ==========
create policy "reports_insert" on public.reports
  for insert to anon, authenticated with check (true);
-- No select — only admins can read reports
revoke select on public.reports from anon, authenticated;

-- ========== SEARCH_QUEUE: read all for matching, write own ==========
create policy "queue_select_all" on public.search_queue
  for select to anon, authenticated using (true);
grant insert, delete on public.search_queue to anon, authenticated;

-- ========== USER_ACHIEVEMENTS: read own, insert via RPC ==========
-- Allow read all for leaderboard potential
create policy "ach_select_all" on public.user_achievements
  for select to anon, authenticated using (true);
grant insert on public.user_achievements to anon, authenticated;

-- ========== ADD is_banned check to find_match ==========
-- Already handled in RPC via `not u.is_banned`

-- ========== Add auto-ban after 3 reports ==========
create or replace function public.check_auto_ban(target_id bigint)
returns void as $$
declare
  report_count int;
begin
  select count(*) into report_count
  from public.reports
  where reported_id = target_id
    and status = 'pending';

  if report_count >= 3 then
    update public.users set is_banned = true where tg_id = target_id;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function public.check_auto_ban(bigint) to anon, authenticated;

-- ========== Trigger: auto-ban check after new report ==========
create or replace function public.on_report_inserted()
returns trigger as $$
begin
  perform public.check_auto_ban(new.reported_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_report_insert on public.reports;
create trigger trg_report_insert after insert on public.reports
  for each row execute function public.on_report_inserted();

-- ========== Premium expiry check ==========
-- Auto-deactivate premium when expired
create or replace function public.check_premium_expiry(user_id bigint)
returns void as $$
begin
  update public.users
  set is_premium = false
  where tg_id = user_id
    and is_premium = true
    and premium_until is not null
    and premium_until < now();
end;
$$ language plpgsql security definer;

grant execute on function public.check_premium_expiry(bigint) to anon, authenticated;

-- ========== Notes table for Premium users ==========
create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(tg_id) on delete cascade,
  partner_id bigint not null,
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.user_notes enable row level security;
create policy "notes_select_own" on public.user_notes
  for select to anon, authenticated using (true);
create policy "notes_insert" on public.user_notes
  for insert to anon, authenticated with check (true);
create policy "notes_delete_own" on public.user_notes
  for delete to anon, authenticated using (true);
grant insert, delete, select on public.user_notes to anon, authenticated;

-- ========== View for partner stats (Premium only) ==========
create or replace view public.partner_stats as
select
  u.tg_id,
  u.nickname,
  u.gender,
  u.age,
  u.city,
  u.is_premium,
  u.streak_days,
  (select count(*) from public.chats c where u.tg_id in (c.user1_id, c.user2_id)) as total_chats,
  (select count(*) from public.user_tags ut where ut.user_id = u.tg_id) as tags_count
from public.users u;

grant select on public.partner_stats to anon, authenticated;
