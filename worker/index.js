// Roulza API — Cloudflare Worker
// Routes: /api/webhook, /api/create-invoice, /api/activate-premium

const PLANS = {
  '1m':  { stars: 199,  days: 30,  label: 'Premium 1 месяц' },
  '3m':  { stars: 499,  days: 90,  label: 'Premium 3 месяца' },
  '12m': { stars: 1499, days: 365, label: 'Premium 1 год' }
};

// HMAC-SHA256 verification for Telegram initData
async function verifyInitData(initData, botToken){
  if(!initData || !botToken) return null;
  try{
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a],[b]]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k,v]) => `${k}=${v}`)
      .join('\n');
    const enc = new TextEncoder();
    const keyData = await crypto.subtle.importKey(
      'raw', enc.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const secretBuf = await crypto.subtle.sign('HMAC', keyData, enc.encode(botToken));
    const secretKey = await crypto.subtle.importKey(
      'raw', secretBuf,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const hashBuf = await crypto.subtle.sign('HMAC', secretKey, enc.encode(dataCheckString));
    const computedHash = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    if(computedHash !== hash) return null;
    const userStr = params.get('user');
    if(!userStr) return null;
    return JSON.parse(userStr);
  }catch(e){ return null; }
}

async function tg(method, payload, botToken){
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

async function sbUpdate(url, key, userId, updates){
  try{
    const r = await fetch(`${url}/rest/v1/users?tg_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updates)
    });
    return r.ok;
  }catch(e){ return false; }
}

async function checkStarPayment(botToken, userId, planCode){
  try{
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getStarTransactions?limit=20`);
    const data = await r.json();
    if(!data.ok) return false;
    const txs = data.result?.transactions || [];
    const plan = PLANS[planCode];
    if(!plan) return false;
    return txs.some(t => t.source && t.source.user?.id === userId && t.amount === plan.stars);
  }catch(e){ return false; }
}

// ============ MAIN HANDLER ============
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret'
    };

    if(request.method === 'OPTIONS'){
      return new Response(null, { headers: corsHeaders });
    }

    // Route
    if(path === '/api/webhook' || path.startsWith('/api/webhook')){
      return handleWebhook(request, env, corsHeaders);
    }
    if(path === '/api/create-invoice'){
      return handleCreateInvoice(request, env, corsHeaders);
    }
    if(path === '/api/activate-premium'){
      return handleActivatePremium(request, env, corsHeaders);
    }

    return new Response(JSON.stringify({
      ok: true,
      app: 'Roulza',
      version: '0.9.0-beta',
      endpoints: ['/api/webhook', '/api/create-invoice', '/api/activate-premium']
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
};

// ============ WEBHOOK ============
async function handleWebhook(request, env, cors){
  if(request.method !== 'POST'){
    return new Response(JSON.stringify({ ok: true, status: 'webhook active', version: '0.9.0-beta' }), {
      headers: { 'Content-Type': 'application/json', ...cors }
    });
  }

  const url = new URL(request.url);
  const secret = request.headers.get('X-Webhook-Secret') || url.searchParams.get('secret');
  const expectedSecret = env.WEBHOOK_SECRET || 'roulza_wh_sec_2026_kX9mPqRsT8vW2yZ';
  if(secret !== expectedSecret){
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...cors }
    });
  }

  const botToken = env.BOT_TOKEN;
  const webappUrl = env.WEBAPP_URL || 'https://roulette-mini-app-digerr-sergo-s-projects1.vercel.app';
  const sbUrl = env.SUPABASE_URL;
  const sbKey = env.SUPABASE_ANON_KEY;
  const update = await request.json();

  // pre_checkout_query
  if(update.pre_checkout_query){
    await tg('answerPreCheckoutQuery', {
      pre_checkout_query_id: update.pre_checkout_query.id,
      ok: true
    }, botToken);
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  }

  // successful_payment
  if(update.message && update.message.successful_payment){
    const payment = update.message.successful_payment;
    const userId = update.message.from.id;
    const parts = (payment.invoice_payload || '').split('_');
    const planCode = parts[1];
    const days = PLANS[planCode]?.days || 30;
    const until = new Date();
    until.setDate(until.getDate() + days);
    await sbUpdate(sbUrl, sbKey, userId, {
      is_premium: true,
      premium_until: until.toISOString()
    });
    await tg('sendMessage', {
      chat_id: update.message.chat.id,
      text: `🎉 *Roulza Premium активирован!*\n\nСрок: ${days} дней\nДействует до: ${until.toLocaleDateString('ru-RU')}\n\nТеперь тебе доступны:\n• Безлимитные диалоги\n• Фильтр по полу собеседника\n• Поиск по городу\n• Уникальный цвет ника`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🎰 ОТКРЫТЬ ПРИЛОЖЕНИЕ', web_app: { url: webappUrl } }]] }
    }, botToken);
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  }

  const msg = update.message;
  if(!msg || !msg.text){
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  }

  const chatId = msg.chat.id;
  const cmd = msg.text.split(' ')[0].toLowerCase();

  if(cmd === '/start'){
    await tg('sendMessage', {
      chat_id: chatId,
      text: '🎲 *Roulza*\n\nАнонимная чат-рулетка внутри Telegram.\n\n• Совпадение по интересам\n• Полная анонимность\n• Премиум-фильтры за Звёзды\n\nЖми кнопку ниже, чтобы крутить колесо 👇',
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🎰 КРУТИТЬ КОЛЕСО', web_app: { url: webappUrl } }]] }
    }, botToken);
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  }

  if(cmd === '/spin'){
    await tg('sendMessage', {
      chat_id: chatId,
      text: '🎡 Готов крутить?',
      reply_markup: { inline_keyboard: [[{ text: '🎰 OPEN ROULETTE', web_app: { url: webappUrl } }]] }
    }, botToken);
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  }

  if(cmd === '/help'){
    await tg('sendMessage', {
      chat_id: chatId,
      text: '📖 *Как пользоваться*\n\n1. Жми кнопку ROULZA слева от поля ввода\n2. Заполни профиль и выбери интересы\n3. Крути колесо — найдём собеседника\n4. Общайся анонимно',
      parse_mode: 'Markdown'
    }, botToken);
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: 'Жми кнопку, чтобы открыть рулетку 👇',
    reply_markup: { inline_keyboard: [[{ text: '🎰 OPEN', web_app: { url: webappUrl } }]] }
  }, botToken);

  return new Response(JSON.stringify({ ok: true }), { headers: cors });
}

// ============ CREATE INVOICE ============
async function handleCreateInvoice(request, env, cors){
  if(request.method !== 'POST'){
    return new Response(JSON.stringify({ ok: true, status: 'invoice endpoint — use POST' }), {
      headers: { 'Content-Type': 'application/json', ...cors }
    });
  }

  try{
    const { plan, user_id } = await request.json();
    if(!plan || !PLANS[plan]){
      return new Response(JSON.stringify({ ok: false, error: 'invalid plan' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }
    if(!user_id){
      return new Response(JSON.stringify({ ok: false, error: 'user_id required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    const p = PLANS[plan];
    const payload = `premium_${plan}_${user_id}_${Date.now()}`;
    const tgData = await tg('createInvoiceLink', {
      title: p.label,
      description: `Подписка Roulza Premium на ${p.days} дней. Безлимит диалогов, фильтр по полу, поиск по городу, цвет ника.`,
      payload: payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: p.label, amount: p.stars }]
    }, env.BOT_TOKEN);

    if(!tgData.ok){
      return new Response(JSON.stringify({ ok: false, error: tgData.description }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      invoice_url: tgData.result,
      payload: payload,
      plan: plan,
      days: p.days,
      stars: p.stars
    }), { headers: { 'Content-Type': 'application/json', ...cors } });
  }catch(e){
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors }
    });
  }
}

// ============ ACTIVATE PREMIUM ============
async function handleActivatePremium(request, env, cors){
  if(request.method !== 'POST'){
    return new Response(JSON.stringify({ ok: true, status: 'activate endpoint — use POST' }), {
      headers: { 'Content-Type': 'application/json', ...cors }
    });
  }

  try{
    const { init_data, plan, user_id } = await request.json();
    if(!plan || !PLANS[plan]){
      return new Response(JSON.stringify({ ok: false, error: 'invalid plan' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    const tgUser = await verifyInitData(init_data, env.BOT_TOKEN);
    if(!tgUser || tgUser.id !== user_id){
      return new Response(JSON.stringify({ ok: false, error: 'invalid init_data' }), {
        status: 403, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    const paid = await checkStarPayment(env.BOT_TOKEN, user_id, plan);
    if(!paid){
      return new Response(JSON.stringify({ ok: false, error: 'payment not found' }), {
        status: 402, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    const days = PLANS[plan].days;
    const until = new Date();
    until.setDate(until.getDate() + days);
    const ok = await sbUpdate(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, user_id, {
      is_premium: true,
      premium_until: until.toISOString()
    });

    return new Response(JSON.stringify({
      ok: ok,
      premium_until: until.toISOString(),
      days: days,
      error: ok ? undefined : 'db update failed'
    }), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json', ...cors }
    });
  }catch(e){
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors }
    });
  }
}
