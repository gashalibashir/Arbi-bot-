// ============================================================
//  ArbScanner Pro — GitHub Actions Edition (FREE 24/7)
//  Runs once every 5 min via GitHub Actions cron. No VPS needed.
// ============================================================

const https = require(“https”);

// ── CONFIG ───────────────────────────────────────────────────
const CONFIG = {
TG_TOKEN   : process.env.TG_TOKEN,
TG_CHAT_ID : process.env.TG_CHAT_ID,

MEXC_FEE_PCT       : 0.1,
BYBIT_FEE_PCT      : 0.1,
MIN_NET_SPREAD_PCT  : 0.3,   // only alert if net profit >= this %
CAPITAL_LEVELS      : [10, 50, 500, 1000],
MAX_ALERTS          : 15,    // max coin alerts per run
SEND_SUMMARY        : true,  // send a summary message at the top
ONLY_USDT           : true,  // only scan USDT pairs
};
// ─────────────────────────────────────────────────────────────

function get(url) {
return new Promise((resolve, reject) => {
const req = https.get(url, { headers: { “User-Agent”: “ArbBot/2.0” } }, (res) => {
let d = “”;
res.on(“data”, (c) => (d += c));
res.on(“end”, () => {
try { resolve(JSON.parse(d)); }
catch (e) { reject(new Error(“Bad JSON from “ + url.split(”?”)[0])); }
});
});
req.on(“error”, reject);
req.setTimeout(12000, () => { req.destroy(); reject(new Error(“Timeout: “ + url)); });
});
}

function tg(text) {
return new Promise((resolve, reject) => {
const body = JSON.stringify({ chat_id: CONFIG.TG_CHAT_ID, text, parse_mode: “HTML” });
const opts = {
hostname: “api.telegram.org”,
path    : `/bot${CONFIG.TG_TOKEN}/sendMessage`,
method  : “POST”,
headers : { “Content-Type”: “application/json”, “Content-Length”: Buffer.byteLength(body) },
};
const req = https.request(opts, (res) => {
let d = “”;
res.on(“data”, (c) => (d += c));
res.on(“end”, () => { const j = JSON.parse(d); j.ok ? resolve(j) : reject(new Error(j.description)); });
});
req.on(“error”, reject);
req.setTimeout(10000, () => { req.destroy(); reject(new Error(“TG timeout”)); });
req.write(body);
req.end();
});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchMEXC() {
const data = await get(“https://api.mexc.com/api/v3/ticker/price”);
const map = {};
for (const { symbol, price } of data) {
if (CONFIG.ONLY_USDT && !symbol.endsWith(“USDT”)) continue;
const p = parseFloat(price);
if (p > 0) map[symbol] = p;
}
return map;
}

async function fetchBybit() {
const data = await get(“https://api.bybit.com/v5/market/tickers?category=spot”);
const map = {};
for (const t of data?.result?.list ?? []) {
if (CONFIG.ONLY_USDT && !t.symbol.endsWith(“USDT”)) continue;
const p = parseFloat(t.lastPrice);
if (p > 0) map[t.symbol] = p;
}
return map;
}

function calcOpps(mexc, bybit) {
const totalFee = (CONFIG.MEXC_FEE_PCT + CONFIG.BYBIT_FEE_PCT) / 100;
const results  = [];

for (const sym of Object.keys(mexc)) {
if (!(sym in bybit)) continue;
const pm = mexc[sym], pb = bybit[sym];

```
let buyEx, sellEx, buyP, sellP;
if (pm < pb) { buyEx = "MEXC"; buyP = pm; sellEx = "Bybit"; sellP = pb; }
else          { buyEx = "Bybit"; buyP = pb; sellEx = "MEXC"; sellP = pm; }

const spreadPct = ((sellP - buyP) / buyP) * 100;
const netPct    = spreadPct - totalFee * 100;
if (netPct < CONFIG.MIN_NET_SPREAD_PCT) continue;

results.push({
  sym,
  coin  : sym.replace("USDT", ""),
  buyEx, sellEx, buyP, sellP,
  spreadPct, netPct,
  profits: CONFIG.CAPITAL_LEVELS.map((c) => ({
    cap: c, profit: +(c * netPct / 100).toFixed(4),
  })),
});
```

}

return results.sort((a, b) => b.netPct - a.netPct);
}

function fmtPrice(n) {
if (n < 0.0001) return n.toExponential(4);
if (n < 1)      return n.toFixed(6);
if (n < 1000)   return n.toFixed(4);
return n.toFixed(2);
}

function fmtOpp(o, rank) {
const medal = rank === 1 ? “🥇” : rank === 2 ? “🥈” : rank === 3 ? “🥉” : “⚡”;
const fire  = o.netPct >= 2 ? “ 🔥🔥” : o.netPct >= 1 ? “ 🔥” : “”;
const lines = o.profits.map((p) => `  💵 <b>$${p.cap}</b> → <b>+$${p.profit}</b>`).join(”\n”);
return (
`${medal} <b>${o.coin}/USDT</b>${fire}\n` +
`━━━━━━━━━━━━━━━━━━━━\n` +
`📥 Buy  <b>${o.buyEx}</b>  @ $${fmtPrice(o.buyP)}\n` +
`📤 Sell <b>${o.sellEx}</b> @ $${fmtPrice(o.sellP)}\n` +
`📊 Spread : <b>${o.spreadPct.toFixed(4)}%</b>\n` +
`💸 Fees   : <b>-${(CONFIG.MEXC_FEE_PCT + CONFIG.BYBIT_FEE_PCT).toFixed(2)}%</b>\n` +
`✨ Net     : <b>+${o.netPct.toFixed(4)}%</b>\n` +
`━━━━━━━━━━━━━━━━━━━━\n` +
`${lines}`
);
}

function fmtSummary(opps, meta, elapsed) {
const top = opps.slice(0, 5).map((o, i) =>
`  ${i + 1}. <b>${o.coin}</b> → +${o.netPct.toFixed(3)}%  |  $10→+$${o.profits[0].profit}`
).join(”\n”);

return (
`📡 <b>ARBOT SCAN</b> — ${new Date().toUTCString()}\n` +
`━━━━━━━━━━━━━━━━━━━━\n` +
`📈 MEXC : <b>${meta.mexcTotal}</b> pairs\n` +
`📈 Bybit: <b>${meta.bybitTotal}</b> pairs\n` +
`🔗 Common: <b>${meta.common}</b> | 🎯 Opps: <b>${opps.length}</b>\n` +
`⏱ Scan time: <b>${elapsed}ms</b>\n` +
`━━━━━━━━━━━━━━━━━━━━\n` +
`<b>TOP PICKS:</b>\n${top || "  None found — try lowering MIN_NET_SPREAD_PCT"}`
);
}

async function main() {
if (!CONFIG.TG_TOKEN || !CONFIG.TG_CHAT_ID) {
console.error(“❌ Missing TG_TOKEN or TG_CHAT_ID — add them as GitHub Secrets”);
process.exit(1);
}

console.log(“⚡ ArbScanner Pro starting scan…”);
const t0 = Date.now();

let mexc, bybit;
try {
[mexc, bybit] = await Promise.all([fetchMEXC(), fetchBybit()]);
} catch (e) {
console.error(“❌ Fetch error:”, e.message);
try { await tg(`⚠ <b>ArbBot fetch error</b>\n<code>${e.message}</code>`); } catch {}
process.exit(1);
}

const common = Object.keys(mexc).filter((s) => s in bybit).length;
const opps   = calcOpps(mexc, bybit);
const elapsed = Date.now() - t0;

const meta = { mexcTotal: Object.keys(mexc).length, bybitTotal: Object.keys(bybit).length, common };
console.log(`✓ MEXC:${meta.mexcTotal} Bybit:${meta.bybitTotal} Common:${common} Opps:${opps.length} ${elapsed}ms`);

// Send summary
if (CONFIG.SEND_SUMMARY) {
try { await tg(fmtSummary(opps, meta, elapsed)); }
catch (e) { console.error(“TG summary error:”, e.message); }
await sleep(600);
}

// Send individual coin alerts
const toSend = opps.slice(0, CONFIG.MAX_ALERTS);
for (let i = 0; i < toSend.length; i++) {
try {
await tg(fmtOpp(toSend[i], i + 1));
console.log(`📨 Sent: ${toSend[i].coin} (+${toSend[i].netPct.toFixed(3)}%)`);
} catch (e) {
console.error(`TG error for ${toSend[i].coin}:`, e.message);
}
await sleep(400);
}

console.log(`✅ Done. ${toSend.length} alerts sent.`);
}

main();
