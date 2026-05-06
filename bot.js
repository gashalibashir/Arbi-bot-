const https = require("https");

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const FEE = 0.1;
const MIN_SPREAD = 0.3;
const CAPITALS = [10, 50, 500, 1000];
const MAX_ALERTS = 10;
const MAX_RETRIES = 8;

function get(url) {
  return new Promise((resolve, reject) => {
    console.log(`→ Fetching: ${url}`);

    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
      }
    }, (res) => {
      console.log(`← Status: ${res.statusCode}`);

      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        console.log(`   Bytes: ${data.length}`);

        if (res.statusCode !== 200) {
          console.error(`❌ HTTP ${res.statusCode}`);
          console.error(data.substring(0, 1000));
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        try {
          const json = JSON.parse(data);
          console.log("✅ JSON parsed successfully");
          resolve(json);
        } catch (e) {
          console.error("❌ JSON Parse Failed");
          console.error("Preview:", data.substring(0, 800));
          reject(new Error("Bad JSON"));
        }
      });
    }).on("error", (e) => {
      console.error("Request error:", e.message);
      reject(e);
    });
  });
}

async function fetchWithRetry(fn, name) {
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      console.warn(`⚠️ Attempt ${i}/${MAX_RETRIES} failed for ${name}: ${e.message}`);
      if (i === MAX_RETRIES) throw e;
      await new Promise(r => setTimeout(r, 4000 * i)); // longer backoff
    }
  }
}

// CoinGecko (reliable)
async function fetchCoinGecko() {
  const data = await fetchWithRetry(() => 
    get("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=150&page=1"),
    "CoinGecko"
  );

  const map = {};
  data.forEach(coin => {
    if (coin.symbol && coin.current_price > 0) {
      map[coin.symbol.toUpperCase() + "USDT"] = coin.current_price;
    }
  });
  console.log(`CoinGecko loaded ${Object.keys(map).length} pairs`);
  return map;
}

// Bitfinex
async function fetchBitfinex() {
  const data = await fetchWithRetry(() => 
    get("https://api-pub.bitfinex.com/v2/tickers?symbols=ALL"),
    "Bitfinex"
  );

  const map = {};
  if (!Array.isArray(data)) return map;

  data.forEach(t => {
    const sym = t[0];
    if (typeof sym !== "string" || !sym.startsWith("t")) return;

    const isUSDT = sym.endsWith("USDT") && !sym.includes(":");
    const isUST = sym.endsWith("UST") && !sym.includes(":");

    if (!isUSDT && !isUST) return;

    const price = parseFloat(t[7]);
    if (price <= 0) return;

    const base = isUSDT ? sym.slice(1, -4) : sym.slice(1, -3);
    if (base && base.length > 1 && !base.includes("F0")) {
      map[base + "USDT"] = price;
    }
  });

  console.log(`Bitfinex loaded ${Object.keys(map).length} pairs`);
  return map;
}

// === Original functions ===
function calcOpps(ex1, ex2, name1, name2) {
  const totalFee = (FEE + FEE) / 100;
  const results = [];

  Object.keys(ex1).forEach(sym => {
    if (!ex2[sym]) return;
    const p1 = ex1[sym], p2 = ex2[sym];

    const [buyEx, buyP, sellEx, sellP] = p1 < p2 
      ? [name1, p1, name2, p2] 
      : [name2, p2, name1, p1];

    const spreadPct = ((sellP - buyP) / buyP) * 100;
    const netPct = spreadPct - totalFee * 100;

    if (netPct < MIN_SPREAD) return;

    results.push({
      coin: sym.replace("USDT", ""),
      buyEx, sellEx, buyP, sellP,
      spreadPct, netPct,
      profits: CAPITALS.map(c => ({cap: c, profit: (c * netPct / 100).toFixed(4)}))
    });
  });

  return results.sort((a,b) => b.netPct - a.netPct);
}

function fmtPrice(n) {
  if (n < 0.0001) return n.toExponential(4);
  if (n < 1) return n.toFixed(6);
  if (n < 1000) return n.toFixed(4);
  return n.toFixed(2);
}

function fmtOpp(o, rank) {
  const lines = o.profits.map(p => `  $${p.cap} → +$${p.profit}`).join("\n");
  return `${rank}. <b>${o.coin}/USDT</b>\nBuy <b>${o.buyEx}</b> @ $${fmtPrice(o.buyP)}\nSell <b>${o.sellEx}</b> @ $${fmtPrice(o.sellP)}\nSpread: <b>${o.spreadPct.toFixed(3)}%</b>\nNet: <b>+${o.netPct.toFixed(3)}%</b>\n${lines}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendTG(text) {
  const body = JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: "HTML" });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { JSON.parse(d).ok ? resolve() : reject(); } catch { reject(); }
      });
    });
    req.on("error", reject);
    req.write(body); req.end();
  });
}

// MAIN
async function main() {
  console.log("🚀 ARBOT STARTED");

  let cg = {}, bf = {};
  try {
    [cg, bf] = await Promise.all([
      fetchWithRetry(fetchCoinGecko, "CoinGecko"),
      fetchWithRetry(fetchBitfinex, "Bitfinex")
    ]);
  } catch (e) {
    console.error("💥 FAILED:", e.message);
    await sendTG(`🚨 ARBOT FAILED\n${new Date().toUTCString()}\n${e.message}`).catch(() => {});
    process.exit(1);
  }

  const opps = calcOpps(cg, bf, "CoinGecko", "Bitfinex");

  await sendTG(`<b>ARBOT SCAN</b> - ${new Date().toUTCString()}\nCoinGecko: <b>${Object.keys(cg).length}</b> | Bitfinex: <b>${Object.keys(bf).length}</b>\nOpps: <b>${opps.length}</b>`);

  const toSend = opps.slice(0, MAX_ALERTS);
  for (let i = 0; i < toSend.length; i++) {
    await sendTG(fmtOpp(toSend[i], i+1));
    await sleep(700);
  }

  console.log("✅ Finished");
}

main().catch(e => { console.error(e); process.exit(1); });
