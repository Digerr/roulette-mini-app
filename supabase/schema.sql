-- ============================================================
-- ChatRoulette — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ---------- USERS ----------
create table if not exists public.users (
  tg_id          bigint primary key,
  username       text,
  first_name     text,
  last_name      text,
  nickname       text not null default 'Анонимус',
  gender         text check (gender in ('male','female','other')) default 'other',
  age            int check (age >= 18),
  city           text,
  is_premium     boolean not null default false,
  premium_until  timestamptz,
  daily_limit    int not null default 10,
  daily_used     int not null default 0,
  daily_reset_at date default current_date,
  streak_days    int not null default 0,
  last_active    date,
  is_banned      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- TAGS (catalog) ----------
create table if not exists public.tags (
  id    serial primary key,
  name  text not null unique,
  emoji text
);

insert into public.tags (name, emoji) values
  ('Игры','🎮'),('Музыка','🎵'),('Кино','🎬'),('Спорт','⚽'),('Книги','📚'),
  ('Путешествия','✈️'),('Еда','🍕'),('IT','💻'),('Арт','🎨'),('Животные','🐾'),
  ('Рок','🎸'),('Астрология','🌙'),('Танцы','💃'),('Фото','📷'),('Авто','🚗'),
  ('Мемы','😂'),('Аниме','⛩️'),('Кофе','☕'),('Вино','🍷'),('Йога','🧘')
on conflict (name) do nothing;

-- ---------- USER_TAGS ----------
create table if not exists public.user_tags (
  user_id bigint not null references public.users(tg_id) on delete cascade,
  tag_id  int    not null references public.tags(id)     on delete cascade,
  primary key (user_id, tag_id)
);

-- ---------- CHATS (dialogs) ----------
create table if not exists public.chats (
  id         uuid primary key default gen_random_uuid(),
  user1_id   bigint not null references public.users(tg_id) on delete cascade,
  user2_id   bigint not null references public.users(tg_id) on delete cascade,
  status     text not null default 'active' check (status in ('active','ended','pinned')),
  pinned     boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  last_msg_at timestamptz,
  last_msg_text text
);

create index if not exists idx_chats_user1 on public.chats(user1_id);
create index if not exists idx_chats_user2 on public.chats(user2_id);
create index if not exists idx_chats_status on public.chats(status);

-- ---------- MESSAGES ----------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  sender_id  bigint not null references public.users(tg_id) on delete cascade,
  text       text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_chat on public.messages(chat_id, created_at);

-- ---------- REPORTS ----------
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  bigint not null references public.users(tg_id) on delete cascade,
  reported_id  bigint not null references public.users(tg_id) on delete cascade,
  chat_id      uuid references public.chats(id) on delete set null,
  reason       text not null,
  comment      text,
  status       text not null default 'pending' check (status in ('pending','resolved','rejected')),
  created_at   timestamptz not null default now()
);

-- ---------- SEARCH QUEUE ----------
create table if not exists public.search_queue (
  user_id     bigint primary key references public.users(tg_id) on delete cascade,
  tags        int[],
  gender_pref text,
  city_pref   text,
  joined_at   timestamptz not null default now()
);

-- ---------- ACHIEVEMENTS (catalog) ----------
create table if not exists public.achievements (
  id    serial primary key,
  code  text not null unique,
  name  text not null,
  emoji text
);

insert into public.achievements (code, name, emoji) values
  ('streak_7','7 дней подряд','🔥'),
  ('chats_100','100 чатов','🏆'),
  ('matches_30','30 матчей','💕'),
  ('premium','Premium','👑'),
  ('days_30','30 дней в apps','🛡️'),
  ('spin_500','500 спинов','🎯'),
  ('chats_50','50 диалогов','⚡'),
  ('legend','Легенда','🔔')
on conflict (code) do nothing;

-- ---------- USER_ACHIEVEMENTS ----------
create table if not exists public.user_achievements (
  user_id        bigint not null references public.users(tg_id) on delete cascade,
  achievement_id int    not null references public.achievements(id) on delete cascade,
  unlocked_at    timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

-- ---------- UPDATED_AT trigger ----------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated before update on public.users
  for each row execute function public.set_updated_at();

-- ---------- STATS view ----------
create or replace view public.user_stats as
select
  u.tg_id,
  u.nickname,
  u.gender,
  u.is_premium,
  u.streak_days,
  u.daily_limit,
  u.daily_used,
  (select count(*) from public.chats c where u.tg_id in (c.user1_id, c.user2_id)) as total_chats,
  (select count(*) from public.chats c where c.status = 'active' and u.tg_id in (c.user1_id, c.user2_id)) as active_chats,
  (select count(*) from public.messages m where m.sender_id = u.tg_id) as messages_sent,
  (select count(*) from public.user_achievements ua where ua.user_id = u.tg_id) as achievements_count
from public.users u;

-- ============================================================
-- ROW LEVEL SECURITY
-- For MVP: permissive policies (anon role can read/write)
-- TODO: harden before production — use Supabase Auth + Telegram initData verification
-- ============================================================
alter table public.users             enable row level security;
alter table public.user_tags         enable row level security;
alter table public.chats             enable row level security;
alter table public.messages          enable row level security;
alter table public.reports           enable row level security;
alter table public.search_queue      enable row level security;
alter table public.user_achievements enable row level security;

-- Permissive policies for MVP (anon can do everything)
create policy "anon_all_users"      on public.users             for all to anon, authenticated using (true) with check (true);
create policy "anon_all_user_tags"  on public.user_tags         for all to anon, authenticated using (true) with check (true);
create policy "anon_all_chats"      on public.chats             for all to anon, authenticated using (true) with check (true);
create policy "anon_all_messages"   on public.messages          for all to anon, authenticated using (true) with check (true);
create policy "anon_all_reports"    on public.reports           for all to anon, authenticated using (true) with check (true);
create policy "anon_all_queue"      on public.search_queue      for all to anon, authenticated using (true) with check (true);
create policy "anon_all_ach"        on public.user_achievements for all to anon, authenticated using (true) with check (true);

-- Tags and achievements: read-only for anon
alter table public.tags enable row level security;
alter table public.achievements enable row level security;
create policy "anon_read_tags" on public.tags for select to anon, authenticated using (true);
create policy "anon_read_ach_catalog" on public.achievements for select to anon, authenticated using (true);
