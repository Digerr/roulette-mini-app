# Roulza

Геймифицированная анонимная чат-рулетка для Telegram.

## Ссылки

- **Bot:** [@RoulzaBot](https://t.me/RoulzaBot)
- **Web App:** https://roulette-mini-app-digerr-sergo-s-projects1.vercel.app
- **GitHub:** https://github.com/Digerr/roulette-mini-app
- **Supabase:** https://otaoqqbtawedvimbirzn.supabase.co

## Возможности

- 🎰 Рулетка-поиск собеседника по интересам
- 👤 Полная анонимность (только ник, без фото/номеров)
- 💬 Realtime-чат через Supabase channels
- 🏆 8 достижений с авто-выдачей
- 🔥 Streak за ежедневные заходы
- ⭐ Premium через Telegram Stars:
  - Безлимит чатов
  - Фильтр по полу собеседника
  - Поиск по городу
  - 8 цветов ника
  - Приоритет в очереди
  - Без рекламы

## Стек

- Frontend: чистый HTML/CSS/JS, Telegram WebApp SDK, Supabase JS SDK
- Backend: Vercel serverless functions (webhook, create-invoice)
- DB: Supabase Postgres + Realtime
- Payments: Telegram Stars (XTR currency)

## Деплой

```bash
vercel --prod
```

## Переменные окружения (опционально)

- `BOT_TOKEN` — токен бота (по умолчанию захардкожен)
- `WEBAPP_URL` — URL Mini App
