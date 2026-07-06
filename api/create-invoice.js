// Create Telegram Stars invoice for Premium subscription
const BOT_TOKEN = process.env.BOT_TOKEN;
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';

const PLANS = {
  '1m':  { stars: 199,  days: 30,  label: 'Premium 1 месяц' },
  '3m':  { stars: 499,  days: 90,  label: 'Premium 3 месяца' },
  '12m': { stars: 1499, days: 365, label: 'Premium 1 год' }
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, status: 'invoice endpoint — use POST' });
  }

  try {
    const { plan, user_id, nickname } = req.body || {};
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ ok: false, error: 'invalid plan' });
    }
    if (!user_id) {
      return res.status(400).json({ ok: false, error: 'user_id required' });
    }

    const p = PLANS[plan];

    // Create invoice via Telegram Bot API
    // currency = XTR means Telegram Stars
    const payload = `premium_${plan}_${user_id}_${Date.now()}`;
    const prices = [{ label: p.label, amount: p.stars }];

    const tgRes = await fetch(`${API}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: p.label,
        description: `Подписка ChatRoulette Premium на ${p.days} дней. Безлимит диалогов, фильтр по полу, поиск по городу, уникальный цвет ника.`,
        payload: payload,
        provider_token: '',  // empty for Telegram Stars
        currency: 'XTR',
        prices: prices
      })
    });

    const tgData = await tgRes.json();
    if (!tgData.ok) {
      return res.status(500).json({ ok: false, error: tgData.description || 'invoice creation failed' });
    }

    return res.status(200).json({
      ok: true,
      invoice_url: tgData.result,
      payload: payload,
      plan: plan,
      days: p.days,
      stars: p.stars
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
