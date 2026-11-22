// runloop — Bullshot farm runner chay tren GitHub Actions (host free, public repo = unlimited minutes).
// env: WALLETS = JSON [{id,address,privateKey}] · TP_KEYS = "key1,key2" (topproxy xoay) · BUDGET_MIN · MAXACC · GAP_MS
import { Wallet } from 'ethers';
import { ProxyAgent, fetch as uf } from 'undici';

const API = 'https://gemapi.bullshot.io/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const HD = { accept: 'application/json', 'content-type': 'application/json', origin: 'https://gem.bullshot.io', referer: 'https://gem.bullshot.io/', 'user-agent': UA };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const W = JSON.parse(process.env.WALLETS || '[]');
const KEYS = String(process.env.TP_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
const BUDGET = Number(process.env.BUDGET_MIN || 330) * 60000;
const MAXACC = Number(process.env.MAXACC || 0) || W.length;
const GAP = Number(process.env.GAP_MS || 260);
const ACCS = W.slice(0, MAXACC);
log(`accs=${ACCS.length} keys=${KEYS.length} budget=${BUDGET / 60000}min`);

const TIER = [
  { minLv: 28, id: 'molten-core', E: 100, mp: 400 },
  { minLv: 20, id: 'void-rift', E: 75, mp: 250 },
  { minLv: 14, id: 'frozen-depths', E: 50, mp: 120 },
  { minLv: 8, id: 'ember-mine', E: 35, mp: 60 },
  { minLv: 4, id: 'crystal-cavern', E: 20, mp: 25 },
  { minLv: 1, id: 'greenstone-quarry', E: 10, mp: 0 },
];
const XPE = { 'void-rift': 13.3, cave: 10, 'molten-core': 11.5, 'frozen-depths': 8, 'ember-mine': 4.3, 'crystal-cavern': 3, 'greenstone-quarry': 2.5 };

let CAVE = null;
async function ensureCave(tok, ag) {
  if (CAVE !== undefined) return;
  try {
    const r = await uf(API + '/mining/locations', { headers: { ...HD, authorization: 'Bearer ' + tok }, dispatcher: ag, signal: AbortSignal.timeout(20000) });
    if (r.status !== 200) { CAVE = null; return; }
    const arr = await r.json();
    const list = Array.isArray(arr) ? arr : arr.locations || [];
    const cv = list.find((x) => String(x.id).startsWith('cave'));
    CAVE = cv ? { minLv: 1, id: cv.id, E: Number(cv.energyCost ?? 5), mp: 0 } : null;
    log('locations=' + list.length + ' cave=' + (CAVE ? CAVE.id + ' E' + CAVE.E : 'none'));
  } catch { CAVE = null; }
}
function bestOpen(lv, mp) {
  if (lv >= 28) return TIER[0];
  if (lv >= 20) return TIER[1];
  const cand = CAVE ? [...TIER.filter((t) => t.minLv <= 13), CAVE] : TIER.filter((t) => t.minLv <= 13);
  const open = cand.filter((t) => lv >= t.minLv && mp >= t.mp);
  if (!open.length) return TIER[TIER.length - 1];
  return open.sort((a, b) => (XPE[b.id] || 0) - (XPE[a.id] || 0) || b.E - a.E)[0];
}

// ---- proxy lanes (topproxy xoay): 1 key -> 1 gateway + egress IP xoay, verify bang get.php ----
const lanes = [];
async function refreshLanes() {
  for (const k of KEYS) {
    if (lanes.find((l) => l.key === k && Date.now() - l.at < 15 * 60000)) continue;
    try {
      const r = await fetch(`https://proxyxoay.shop/api/get.php?key=${encodeURIComponent(k)}&nhamang=Random`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
      const js = await r.json();
      if (js.status === 100 && js.proxyhttp) {
        const gw = String(js.proxyhttp).replace(/::$/, '');
        const old = lanes.find((l) => l.key === k);
        if (old) { try { old.ag.close(); } catch { } Object.assign(old, { gw, ag: new ProxyAgent('http://' + gw), ip: js.ip, at: Date.now() }); }
        else lanes.push({ key: k.slice(-6), gw, ag: new ProxyAgent('http://' + gw), ip: js.ip, at: Date.now() });
        log('lane ' + k.slice(-6) + ' -> ' + gw + ' egress=' + js.ip);
      } else log('lane ' + k.slice(-6) + ' get.php status=' + js.status + ' ' + (js.message || ''));
    } catch (e) { log('lane ' + k.slice(-6) + ' ERR ' + e.message.slice(0, 60)); }
  }
  return lanes.length;
}
if (!KEYS.length) { log('KHONG CO TP_KEYS -> thoat (cam dung IP runner truc tiep)'); process.exit(3); }
if (!(await refreshLanes())) { log('KHONG LANE NAO SONG -> thoat'); process.exit(3); }

let eNet = 0, eReq = 0;
async function api(ag, path, { method = 'GET', body, token } = {}) {
  const h = { ...HD };
  if (token) h.authorization = 'Bearer ' + token;
  try {
    const r = await uf(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, dispatcher: ag, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    let js = null; try { js = JSON.parse(t); } catch { }
    eReq++;
    return { status: r.status, js, t: t.slice(0, 160) };
  } catch (e) { eNet++; return { status: 0, js: null, t: e.message.slice(0, 80) }; }
}

const T = { rounds: 0, accs: 0, ok: 0, claims: 0, starts: 0, stale: 0, net: 0, bad: 0, gems: 0, xp: 0 };
async function login(acc, ag) {
  const n = await api(ag, '/auth/nonce', { method: 'POST', body: { walletAddress: acc.address } });
  if (n.status !== 200 || !n.js?.message) return null;
  const signature = await new Wallet(acc.privateKey).signMessage(n.js.message);
  const l = await api(ag, '/auth/login', { method: 'POST', body: { walletAddress: acc.address, signature, message: n.js.message } });
  return l.status === 200 ? l.js?.token || null : null;
}
async function work(acc, i) {
  const lane = lanes[i % lanes.length], ag = lane.ag;
  try {
    if (!acc.token) {
      acc.token = await login(acc, ag);
      if (!acc.token) { acc.fail = (acc.fail || 0) + 1; T.stale++; return; }
    }
    let pr = await api(ag, '/mining/positions', { token: acc.token });
    if (pr.status === 401 || pr.status === 403) {
      acc.token = await login(acc, ag);
      if (!acc.token) { T.stale++; return; }
      pr = await api(ag, '/mining/positions', { token: acc.token });
    }
    if (pr.status !== 200) { if (pr.status !== 429) T.bad++; return; }
    const plist = Array.isArray(pr.js) ? pr.js : pr.js?.positions || [];
    const now = Date.now();
    for (const p of plist) {
      const ready = p.status === 'completed' || p.status === 'ready' || p.claimable === true || (p.endsAt && new Date(p.endsAt).getTime() <= now);
      if (!ready) continue;
      const c = await api(ag, `/mining/positions/${p.id}/claim`, { method: 'POST', body: {}, token: acc.token });
      if (c.status === 200) T.claims++;
      await sleep(GAP);
    }
    const me = await api(ag, '/user/me', { token: acc.token });
    if (me.status !== 200) return;
    const lv = Number(me.js.level || 0), en = Number(me.js.energy || 0), cap = Number(me.js.energyCapacity || 0), mp = Number(me.js.miningPower || 0);
    if (Number.isFinite(Number(me.js.gems))) T.gems += Number(me.js.gems);
    if (Number.isFinite(Number(me.js.xp))) T.xp += Number(me.js.xp);
    await ensureCave(acc.token, ag);
    const t = bestOpen(lv, mp);
    if (mp < t.mp) return;                       // thieu MP -> doi (khong xuong mo bac thap hon)
    const active = plist.filter((p) => p.status === 'active').length;
    const slotMax = Math.floor(cap / t.E);
    let want = Math.min(Math.max(0, slotMax - active), Math.floor(en / t.E));
    for (let s = 0; s < want; s++) {
      const p2 = await api(ag, '/mining/positions', { method: 'POST', body: { locationId: t.id }, token: acc.token });
      if (p2.status === 200) { T.starts++; await sleep(GAP); } else break;
    }
    T.ok++;
    if (T.ok % 25 === 0) log(`  ... ok=${T.ok} claims=${T.claims} starts=${T.starts} accs=${T.accs}`);
  } catch (e) { T.net++; }
}

const DEADLINE = Date.now() + BUDGET;
while (Date.now() < DEADLINE) {
  T.rounds++;
  for (let i = 0; i < ACCS.length; i++) {
    if (Date.now() > DEADLINE) break;
    T.accs++;
    await work(ACCS[i], i);
    await sleep(GAP);
  }
  log(`ROUND ${T.rounds}: ok=${T.ok} claims=${T.claims} starts=${T.starts} stale=${T.stale} bad=${T.bad} net=${eNet}/${eReq} gems=${T.gems} xp=${T.xp}`);
  // revive lane neu egress chet hang loat (0dn)
  if (eNet > Math.max(20, eReq * 0.25)) { log('net fail cao -> xoay lai lane'); lanes.length = 0; await refreshLanes(); eNet = 0; eReq = 0; }
  await sleep(30000);
}
log('DONE ' + JSON.stringify(T));
