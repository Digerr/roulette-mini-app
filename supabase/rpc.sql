-- ============================================================
-- ChatRoulette — RPC functions & triggers
-- Run AFTER schema.sql
-- ============================================================

-- ---------- MATCHMAKING: find a partner ----------
-- Returns a user_id of a matched partner, or NULL if none found
-- Match logic: user in search_queue with at least 1 overlapping tag
create or replace function public.find_match(searcher_id bigint)
returns bigint as $$
declare
  searcher_tags int[];
  partner_id bigint;
begin
  -- Get searcher's tags from search_queue
  select tags into searcher_tags
  from public.search_queue
  where user_id = searcher_id;

  if searcher_tags is null then
    -- No tags in queue — fetch from user_tags
    select array_agg(tag_id) into searcher_tags
    from public.user_tags
    where user_id = searcher_id;
  end if;

  if searcher_tags is null or array_length(searcher_tags, 1) is null then
    return null;
  end if;

  -- Find another user in queue (not self, not banned) with overlapping tags
  select q.user_id into partner_id
  from public.search_queue q
  where q.user_id <> searcher_id
    and q.user_id not in (
      select reported_id from public.reports
      where reporter_id = searcher_id
      union
      select reporter_id from public.reports
      where reported_id = searcher_id
    )
    and exists (
      select 1 from public.user_tags ut
      where ut.user_id = q.user_id
        and ut.tag_id = any(searcher_tags)
    )
    and not exists (
      -- no active chat between these two
      select 1 from public.chats c
      where c.status = 'active'
        and ((c.user1_id = searcher_id and c.user2_id = q.user_id)
          or (c.user1_id = q.user_id and c.user2_id = searcher_id))
    )
  order by q.joined_at asc
  limit 1;

  return partner_id;
end;
$$ language plpgsql security definer;

-- ---------- LIMIT RESET ----------
-- Resets daily_used to 0 if date changed
create or replace function public.reset_daily_limit(user_id bigint)
returns public.users as $$
declare
  u public.users;
begin
  select * into u from public.users where tg_id = user_id;
  if not found then
    return null;
  end if;

  if u.daily_reset_at is null or u.daily_reset_at < current_date then
    update public.users
    set daily_used = 0, daily_reset_at = current_date
    where tg_id = user_id
    returning * into u;
  end if;

  return u;
end;
$$ language plpgsql security definer;

-- ---------- INCREMENT DAILY USED ----------
-- Returns updated user, or NULL if limit reached
create or replace function public.increment_daily_used(user_id bigint)
returns public.users as $$
declare
  u public.users;
begin
  select * into u from public.users where tg_id = user_id;
  if not found then return null; end if;

  -- Reset if new day
  if u.daily_reset_at is null or u.daily_reset_at < current_date then
    update public.users
    set daily_used = 0, daily_reset_at = current_date
    where tg_id = user_id
    returning * into u;
  end if;

  -- Premium users bypass limit
  if u.is_premium then
    return u;
  end if;

  -- Check limit
  if u.daily_used >= u.daily_limit then
    return null;
  end if;

  -- Increment
  update public.users
  set daily_used = daily_used + 1
  where tg_id = user_id
  returning * into u;

  return u;
end;
$$ language plpgsql security definer;

-- ---------- UNLOCK ACHIEVEMENT ----------
-- Idempotent — safe to call multiple times
create or replace function public.unlock_achievement(user_id bigint, ach_code text)
returns boolean as $$
declare
  ach_id int;
  already_unlocked boolean;
begin
  select id into ach_id from public.achievements where code = ach_code;
  if not found then return false; end if;

  select exists(
    select 1 from public.user_achievements
    where user_id = user_id and achievement_id = ach_id
  ) into already_unlocked;

  if already_unlocked then return false; end if;

  insert into public.user_achievements (user_id, achievement_id)
  values (user_id, ach_id);
  return true;
end;
$$ language plpgsql security definer;

-- ---------- CHECK & UNLOCK ACHIEVEMENTS ----------
-- Auto-check all achievements for a user
create or replace function public.check_achievements(user_id bigint)
returns table(code text, name text, emoji text, just_unlocked boolean) as $$
declare
  u public.users;
  total_chats int;
  total_matches int;
  streak int;
  days_active int;
  spins int;
begin
  select * into u from public.users where tg_id = user_id;
  if not found then return; end if;

  -- Compute metrics
  select count(*) into total_chats
  from public.chats c
  where user_id in (c.user1_id, c.user2_id);

  select count(*) into total_matches
  from public.chats c
  where c.status in ('active','ended')
    and user_id in (c.user1_id, c.user2_id);

  streak := coalesce(u.streak_days, 0);
  days_active := coalesce(extract(day from now() - u.created_at)::int, 0);
  -- spins approximated by total_chats * 2
  spins := total_chats * 2;

  -- Check each
  return query
  select a.code, a.name, a.emoji,
    public.unlock_achievement(user_id, a.code) as just_unlocked
  from public.achievements a
  where (a.code = 'streak_7' and streak >= 7)
     or (a.code = 'chats_100' and total_chats >= 100)
     or (a.code = 'matches_30' and total_matches >= 30)
     or (a.code = 'premium' and u.is_premium)
     or (a.code = 'days_30' and days_active >= 30)
     or (a.code = 'spin_500' and spins >= 500)
     or (a.code = 'chats_50' and total_chats >= 50)
     or (a.code = 'legend' and total_chats >= 200 and u.is_premium);

  -- Also return already-unlocked ones (just_unlocked = false)
  return query
  select a.code, a.name, a.emoji, false as just_unlocked
  from public.achievements a
  join public.user_achievements ua on ua.achievement_id = a.id
  where ua.user_id = user_id
    and a.code not in (
      select x.code from (
        select a2.code
        from public.achievements a2
        where (a2.code = 'streak_7' and streak >= 7)
           or (a2.code = 'chats_100' and total_chats >= 100)
           or (a2.code = 'matches_30' and total_matches >= 30)
           or (a2.code = 'premium' and u.is_premium)
           or (a2.code = 'days_30' and days_active >= 30)
           or (a2.code = 'spin_500' and spins >= 500)
           or (a2.code = 'chats_50' and total_chats >= 50)
           or (a2.code = 'legend' and total_chats >= 200 and u.is_premium)
      ) x
    );
end;
$$ language plpgsql security definer;

-- ---------- UPDATE STREAK ----------
-- Call on user activity: increments streak if last_active < today
create or replace function public.update_streak(user_id bigint)
returns void as $$
declare
  u public.users;
begin
  select * into u from public.users where tg_id = user_id;
  if not found then return; end if;

  if u.last_active is null then
    update public.users set streak_days = 1, last_active = current_date where tg_id = user_id;
  elsif u.last_active = current_date - 1 then
    -- yesterday → increment
    update public.users set streak_days = streak_days + 1, last_active = current_date where tg_id = user_id;
  elsif u.last_active < current_date - 1 then
    -- gap → reset
    update public.users set streak_days = 1, last_active = current_date where tg_id = user_id;
  end if;
  -- if last_active = today → do nothing
end;
$$ language plpgsql security definer;

-- ---------- GRANT EXECUTE ----------
grant execute on function public.find_match(bigint) to anon, authenticated;
grant execute on function public.reset_daily_limit(bigint) to anon, authenticated;
grant execute on function public.increment_daily_used(bigint) to anon, authenticated;
grant execute on function public.unlock_achievement(bigint, text) to anon, authenticated;
grant execute on function public.check_achievements(bigint) to anon, authenticated;
grant execute on function public.update_streak(bigint) to anon, authenticated;
