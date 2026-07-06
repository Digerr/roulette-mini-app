// Verify Telegram initData and activate Premium after payment
// This endpoint is called by client after successful tg.openInvoice('paid')
// It verifies the payment via Telegram getStarTransactions before activating

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;

const PLANS = {
  '1m':  { stars: 199,  days: 30 },
  '3m':  { stars: 499,  days: 90 },
  '12m': { stars: 1499, days: 365 }
};

// Verify Telegram initData signature
// initData format: query=params&hash=xxx
// Secret key = HMAC-SHA256(bot_token, "WebAppData")
async function verifyInitData(initData){
  if(!initData) return null;
  try{
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    // Sort params alphabetically
    const dataCheckString = Array.from(params.entries())
      .sort(([a],[b]]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k,v]) => `${k}=${v}`)
      .join('\n');
    // Create secret key: HMAC-SHA256(bot_token, "WebAppData")
    const enc = new TextEncoder();
    const keyData = await crypto.subtle.importKey(
      'raw', enc.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const secretBuf = await crypto.subtle.sign('HMAC', keyData, enc.encode(BOT_TOKEN));
    const secretKey = await crypto.subtle.importKey(
      'raw', secretBuf,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const hashBuf = await crypto.subtle.sign('HMAC', secretKey, enc.encode(dataCheckString));
    const computedHash = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    if(computedHash !== hash) return null;
    // Parse user
    const userStr = params.get('user');
    if(!userStr) return null;
    return JSON.parse(userStr);
  }catch(e){
    console.error('verifyInitData error:', e);
    return null;
  }
}

async function sbUpdate(userId, updates){
  try{
    const r = await fetch(`${SB_URL}/rest/v1/users?tg_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updates)
    });
    return r.ok;
  }catch(e){ return false; }
}

async function checkStarPayment(userId, planCode){
  // Check bot's recent star transactions for this user
  try{
    const r = await fetch(`${API}/getStarTransactions?limit=20`, {
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await r.json();
    if(!data.ok) return false;
    const txs = data.result?.transactions || [];
    const plan = PLANS[planCode];
    if(!plan) return false;
    // Look for incoming transaction from this user with matching amount
    const found = txs.find(t =>
      t.source &&
      t.source.user?.id === userId &&
      t.amount === plan.stars
    );
    return !!found;
  }catch(e){
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, status: 'activate endpoint — use POST' });
  }

  try{
    const { init_data, plan, user_id } = req.body || {};
    if(!plan || !PLANS[plan]){
      return res.status(400).json({ ok: false, error: 'invalid plan' });
    }
    if(!BOT_TOKEN || !SB_URL){
      return res.status(500).json({ ok: false, error: 'server not configured' });
    }

    // Step 1: Verify initData signature (proves user is who they claim)
    const tgUser = await verifyInitData(init_data);
    if(!tgUser || tgUser.id !== user_id){
      return res.status(403).json({ ok: false, error: 'invalid init_data' });
    }

    // Step 2: Verify payment via Telegram Stars transactions
    const paid = await checkStarPayment(user_id, plan);
    if(!paid){
      return res.status(402).json({ ok: false, error: 'payment not found' });
    }

    // Step 3: Activate premium in DB
    const days = PLANS[plan].days;
    const until = new Date();
    until.setDate(until.getDate() + days);
    const ok = await sbUpdate(user_id, {
      is_premium: true,
      premium_until: until.toISOString()
    });

    if(ok){
      return res.status(200).json({
        ok: true,
        premium_until: until.toISOString(),
        days: days
      });
    } else {
      return res.status(500).json({ ok: false, error: 'db update failed' });
    }
  }catch(e){
    return res.status(500).json({ ok: false, error: e.message });
  }
}
