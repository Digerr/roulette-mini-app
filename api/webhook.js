// Telegram bot webhook handler for Vercel serverless
const BOT_TOKEN = process.env.BOT_TOKEN || '8841799446:AAEBGN75o9dHuQUKy3VYCZ8bVI6h0qUhQ7U';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://roulette-mini-app-digerr-sergo-s-projects1.vercel.app';
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const SB_URL = 'https://otaoqqbtawedvimbirzn.supabase.co';
const SB_KEY = 'sb_publishable_sj5BCNByv5jL8uS_FpI6Ag_q8SklQTR';

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

async function sbUpdate(userId, updates){
  try{
    await fetch(`${SB_URL}/rest/v1/users?tg_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updates)
    });
  }catch(e){}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, status: 'webhook active' });
  }

  const update = req.body;

  // Handle pre_checkout_query — must answer within 10 seconds
  if (update.pre_checkout_query) {
    const pcq = update.pre_checkout_query;
    // Auto-approve
    await tg('answerPreCheckoutQuery', {
      pre_checkout_query_id: pcq.id,
      ok: true
    });
    return res.status(200).json({ ok: true });
  }

  // Handle successful_payment — activate premium in DB
  if (update.message && update.message.successful_payment) {
    const payment = update.message.successful_payment;
    const userId = update.message.from.id;
    const payload = payment.invoice_payload || '';

    // Parse plan from payload: premium_1m_<userid>_<ts>
    const parts = payload.split('_');
    const planCode = parts[1]; // 1m / 3m / 12m
    const days = planCode === '1m' ? 30 : planCode === '3m' ? 90 : planCode === '12m' ? 365 : 30;

    // Activate premium in Supabase
    const until = new Date();
    until.setDate(until.getDate() + days);
    await sbUpdate(userId, {
      is_premium: true,
      premium_until: until.toISOString()
    });

    await tg('sendMessage', {
      chat_id: update.message.chat.id,
      text: `🎉 *Premium активирован!*\n\nСрок: ${days} дней\nДействует до: ${until.toLocaleDateString('ru-RU')}\n\nТеперь тебе доступны:\n• Безлимитные диалоги\n• Фильтр по полу собеседника\n• Поиск по городу\n• Уникальный цвет ника`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎰 ОТКРЫТЬ ПРИЛОЖЕНИЕ', web_app: { url: WEBAPP_URL } }
        ]]
      }
    });
    return res.status(200).json({ ok: true });
  }

  const msg = update.message;
  if (!msg || !msg.text) {
    return res.status(200).json({ ok: true });
  }

  const chatId = msg.chat.id;
  const text = msg.text || '';
  const cmd = text.split(' ')[0].toLowerCase();

  if (cmd === '/start') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '🎲 *ChatRoulette*\n\nАнонимная чат-рулетка внутри Telegram.\n\n• Совпадение по интересам\n• Полная анонимность\n• Премиум-фильтры за Звёзды\n\nЖми кнопку ниже, чтобы крутить колесо 👇',
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎰 КРУТИТЬ КОЛЕСО', web_app: { url: WEBAPP_URL } }
        ]]
      }
    });
    return res.status(200).json({ ok: true });
  }

  if (cmd === '/spin') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '🎡 Готов крутить?',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎰 OPEN ROULETTE', web_app: { url: WEBAPP_URL } }
        ]]
      }
    });
    return res.status(200).json({ ok: true });
  }

  if (cmd === '/help') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '📖 *Как пользоваться*\n\n1. Жми кнопку ROULETTE слева от поля ввода\n2. Заполни профиль и выбери интересы\n3. Крути колесо — найдём собеседника\n4. Общайся анонимно\n\nКоманды:\n/start — приветствие\n/spin — открыть рулетку\n/help — эта справка',
      parse_mode: 'Markdown'
    });
    return res.status(200).json({ ok: true });
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: 'Жми кнопку, чтобы открыть рулетку 👇',
    reply_markup: {
      inline_keyboard: [[
        { text: '🎰 OPEN', web_app: { url: WEBAPP_URL } }
      ]]
    }
  });

  return res.status(200).json({ ok: true });
}
