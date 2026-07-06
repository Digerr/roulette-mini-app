// Telegram bot webhook handler for Vercel serverless
const BOT_TOKEN = process.env.BOT_TOKEN || '8841799446:AAEBGN75o9dHuQUKy3VYCZ8bVI6h0qUhQ7U';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://roulette-mini-app-digerr-sergo-s-projects1.vercel.app';
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, status: 'webhook active' });
  }

  const update = req.body;
  const msg = update.message;
  if (!msg || !msg.text) {
    return res.status(200).json({ ok: true });
  }

  const chatId = msg.chat.id;
  const text = msg.text || '';
  const cmd = text.split(' ')[0].toLowerCase();

  // /start — welcome message with inline Web App button
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

  // /spin — same button
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

  // /help
  if (cmd === '/help') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '📖 *Как пользоваться*\n\n1. Жми кнопку ROULETTE слева от поля ввода\n2. Заполни профиль и выбери интересы\n3. Крути колесо — найдём собеседника\n4. Общайся анонимно\n\nКоманды:\n/start — приветствие\n/spin — открыть рулетку\n/help — эта справка',
      parse_mode: 'Markdown'
    });
    return res.status(200).json({ ok: true });
  }

  // Default — echo with Web App button
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
