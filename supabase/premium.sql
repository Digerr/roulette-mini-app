-- ============================================================
-- ChatRoulette — Premium features update
-- Run AFTER schema.sql + rpc.sql
-- ============================================================

-- ---------- Add nick_color to users ----------
alter table public.users
  add column if not exists nick_color text default null,
  add column if not exists gender_pref text,
  add column if not exists city_pref text;

-- ---------- Drop old find_match and recreate with preferences ----------
drop function if exists public.find_match(bigint);

create or replace function public.find_match(searcher_id bigint)
returns bigint as $$
declare
  searcher_tags int[];
  searcher_gender_pref text;
  searcher_city_pref text;
  partner_id bigint;
  u record;
begin
  -- Get searcher's preferences
  select gender_pref, city_pref into searcher_gender_pref, searcher_city_pref
  from public.users where tg_id = searcher_id;

  -- Get searcher's tags from search_queue
  select tags into searcher_tags
  from public.search_queue
  where user_id = searcher_id;

  if searcher_tags is null then
    select array_agg(tag_id) into searcher_tags
    from public.user_tags
    where user_id = searcher_id;
  end if;

  if searcher_tags is null or array_length(searcher_tags, 1) is null then
    return null;
  end if;

  -- Find another user in queue (not self, not banned) with overlapping tags
  -- Premium users get priority (is_premium desc), then by join time
  select q.user_id into partner_id
  from public.search_queue q
  join public.users u on u.tg_id = q.user_id
  where q.user_id <> searcher_id
    and not u.is_banned
    and q.user_id not in (
      select reported_id from public.reports
      where reporter_id = searcher_id
      union
      select reporter_id from public.reports
      where reported_id = searcher_id
    )
    -- Apply gender filter if searcher has preference
    and (searcher_gender_pref is null or u.gender = searcher_gender_pref)
    -- Apply city filter if searcher has preference
    and (searcher_city_pref is null or u.city = searcher_city_pref)
    and exists (
      select 1 from public.user_tags ut
      where ut.user_id = q.user_id
        and ut.tag_id = any(searcher_tags)
    )
    and not exists (
      select 1 from public.chats c
      where c.status = 'active'
        and ((c.user1_id = searcher_id and c.user2_id = q.user_id)
          or (c.user1_id = q.user_id and c.user2_id = searcher_id))
    )
  order by u.is_premium desc, q.joined_at asc
  limit 1;

  return partner_id;
end;
$$ language plpgsql security definer;

grant execute on function public.find_match(bigint) to anon, authenticated;

-- ---------- Allowed nick colors ----------
create table if not exists public.nick_colors (
  id    serial primary key,
  code  text not null unique,
  name  text not null,
  hex   text not null,
  premium_only boolean not null default true
);

insert into public.nick_colors (code, name, hex, premium_only) values
  ('red',    'Красный',   '#e5342b', true),
  ('gold',   'Золотой',   '#ffd600', true),
  ('lime',   'Лайм',      '#c6ff00', true),
  ('blue',   'Голубой',   '#2aabee', true),
  ('purple', 'Фиолетовый','#8b5cf6', true),
  ('pink',   'Розовый',   '#ff5e94', true),
  ('cyan',   'Бирюзовый', '#00d4ff', true),
  ('orange', 'Оранжевый', '#ff9500', true)
on conflict (code) do nothing;

alter table public.nick_colors enable row level security;
create policy "anon_read_colors" on public.nick_colors for select to anon, authenticated using (true);
