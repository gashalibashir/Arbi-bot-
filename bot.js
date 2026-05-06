const https = require("https");

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const FEE = 0.1;
const MIN_SPREAD = 0.3;
const CAPITALS = [10, 50, 500, 1000];
const MAX_ALERTS = 10;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT = 30000; // 30 seconds

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate"
      }
    }, (res) => {
      let data = "";

      // Check status code immediately
      if (res.statusCode !== 200) {
        console.error(`Bad HTTP status ${res.statusCode} from ${url}`);
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => {
          console.error("Body preview:", data.substring(0, 800));
          reject(new Error(`HTTP ${res.statusCode}`));
        });
        return;
      }

      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          console.error("Bad JSON from " + url);
          console.error("Status: " + res.statusCode);
          console.error("Body preview: " + data.substring(0, 800));
          reject(new Error("JSON parse failed: " + e.message));
        }
      });
    });

    req.on("error", (e) => {
      console.error("Request error for " + url + ": " + e.message);
      reject(e);
    });

    req.setTimeout(REQUEST_TIMEOUT, () => {
      req.destroy();
      reject(new Error("Timeout: " + url));
    });
  });
}

async function fetchWithRetry(fn, name) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Fetching ${name} (attempt ${attempt}/${MAX_RETRIES})...`);
      return await fn();
    } catch (e) {
      console.warn(`${name} attempt ${attempt} failed: ${e.message}`);
      if (attempt === MAX_RETRIES) throw e;
      await sleep(1500 * attempt); // exponential backoff
    }
  }
}

// Kraken
async function fetchKraken() {
  const pairsData = await fetchWithRetry(() => 
    get("https://api.kraken.com/0/public/AssetPairs"), "Kraken AssetPairs"
  );

  const pairMap = {};
  if (pairsData.result) {
    Object.keys(pairsData.result).forEach(key => {
      const pair = pairsData.result[key];
      if (pair.wsname && pair.wsname.endsWith("/USDT")) {
        let base = pair.wsname.replace("/USDT", "").replace("XBT", "BTC");
        pairMap[key] = base + "USDT";
      }
    });
  }
  console.log(`Kraken USDT pairs found: ${Object.keys(pairMap).length}`);

  const tickerData = await fetchWithRetry(() => 
    get("https://api.kraken.com/0/public/Ticker"), "Kraken Ticker"
  );

  const map = {};
  if (tickerData.result) {
    Object.keys(tickerData.result).forEach(key => {
      const sym = pairMap[key];
      if (!sym) return;
      const p = parseFloat(tickerData.result[key].c[0]);
      if (p > 0) map[sym] = p;
    });
  }
  console.log(`Kraken final USDT pairs: ${Object.keys(map).length}`);
  return map;
}

// Bitfinex
async function fetchBitfinex() {
  const data = await fetchWithRetry(() => 
    get("https://api-pub.bitfinex.com/v2/tickers?symbols=ALL"), "Bitfinex"
  );

  const map = {};
  if (!Array.isArray(data)) {
    console.error("Bitfinex: expected array");
    return map;
  }

  data.forEach(ticker => {
    const sym = ticker[0];
    if (!sym || typeof sym !== "string" || !sym.startsWith("t")) return;

    const isUST = sym.endsWith("UST") && !sym.includes(":");
    const isUSDT = sym.endsWith("USDT") && !sym.includes(":");

    if (!isUST && !isUSDT) return;

    const p = parseFloat(ticker[7]);
    if (!p || p <= 0) return;

    let base = isUST ? sym.slice(1, -3) : sym.slice(1, -4);
    if (!base || base.includes("F0") || base.length < 2) return;

    map[base + "USDT"] = p;
  });

  console.log(`Bitfinex USDT pairs: ${Object.keys(map).length}`);
  return map;
}

function calcOpps(ex1, ex2, name1, name2) {
  const totalFee = (FEE + FEE) / 100;
  const results = [];

  Object.keys(ex1).forEach(sym => {
    if (!ex2[sym]) return;
    const p1 = ex1[sym];
    const p2 = ex2[sym];

    let buyEx, sellEx, buyP, sellP;
    if (p1 < p2) {
      buyEx = name1; buyP = p1; sellEx = name2; sellP = p2;
    } else {
      buyEx = name2; buyP = p2; sellEx = name1; sellP = p1;
    }

    const spreadPct = ((sellP - buyP) / buyP) * 100;
    const netPct = spreadPct - (totalFee * 100);

    if (netPct < MIN_SPREAD) return;

    const profits = CAPITALS.map(c => ({
      cap: c,
      profit: (c * netPct / 100).toFixed(4)
    }));

    results.push({
      coin: sym.replace("USDT", ""),
      buyEx, sellEx,
      buyP, sellP,
      spreadPct, netPct,
      profits
    });
  });

  results.sort((a, b) => b.netPct - a.netPct);
  return results;
}

function fmtPrice(n) {
  if (n < 0.0001) return n.toExponential(4);
  if (n < 1) return n.toFixed(6);
  if (n < 1000) return n.toFixed(4);
  return n.toFixed(2);
}

function fmtOpp(o, rank) {
  const lines = o.profits.map(p => `  $${p.cap} -> +$${p.profit}`).join("\n");
  return (
    `${rank}. <b>${o.coin}/USDT</b>\n` +
    `Buy  <b>${o.buyEx}</b> @ $${fmtPrice(o.buyP)}\n` +
    `Sell <b>${o.sellEx}</b> @ $${fmtPrice(o.sellP)}\n` +
    `Spread: <b>${o.spreadPct.toFixed(3)}%</b>\n` +
    `Fees: <b>-${(FEE + FEE).toFixed(2)}%</b>\n` +
    `Net: <b>+${o.netPct.toFixed(3)}%</b>\n` +
    lines
  );
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendTG(text) {
  const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: text, parse_mode: "HTML" });
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.telegram.org",
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(opts, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const j = JSON.parse(d);
          if (j.ok) resolve(j);
          else reject(new Error(j.description || "Telegram error"));
        } catch (e) {
          reject(new Error("TG parse error"));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("TG Timeout")); });
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    console.error("Missing TG_TOKEN or TG_CHAT_ID");
    process.exit(1);
  }

  console.log("Starting arbitrage scan...");

  let kraken = {}, bitfinex = {};
  try {
    [kraken, bitfinex] = await Promise.all([
      fetchWithRetry(fetchKraken, "Kraken"),
      fetchWithRetry(fetchBitfinex, "Bitfinex")
    ]);
  } catch (e) {
    console.error("Critical fetch failure:", e.message);
    try {
      await sendTG(`🚨 ARBOT SCAN FAILED\n${new Date().toUTCString()}\nError: ${e.message}`);
    } catch (_) {}
    process.exit(1);
  }

  const krakenTotal = Object.keys(kraken).length;
  const bitfinexTotal = Object.keys(bitfinex).length;
  const common = Object.keys(kraken).filter(s => bitfinex[s]).length;

  console.log(`Kraken pairs: ${krakenTotal} | Bitfinex: ${bitfinexTotal} | Common: ${common}`);

  if (krakenTotal === 0 || bitfinexTotal === 0) {
    await sendTG(`🚨 ARBOT SCAN FAILED - No data\nKraken=${krakenTotal} Bitfinex=${bitfinexTotal}`);
    process.exit(1);
  }

  const opps = calcOpps(kraken, bitfinex, "Kraken", "Bitfinex");

  const summary = 
    `<b>ARBOT SCAN</b> - ${new Date().toUTCString()}\n` +
    `Kraken: <b>${krakenTotal}</b> | Bitfinex: <b>${bitfinexTotal}</b>\n` +
    `Common pairs: <b>${common}</b>\n` +
    `Opportunities: <b>${opps.length}</b> (≥ ${MIN_SPREAD}% net)`;

  try { await sendTG(summary); } catch (e) { console.error("TG summary error:", e.message); }
  await sleep(600);

  const toSend = opps.slice(0, MAX_ALERTS);
  for (let i = 0; i < toSend.length; i++) {
    try {
      await sendTG(fmtOpp(toSend[i], i + 1));
      console.log(`Sent alert: ${toSend[i].coin}`);
    } catch (e) {
      console.error(`Failed to send alert ${i+1}:`, e.message);
    }
    await sleep(500);
  }

  console.log(`Done. Sent ${toSend.length} alerts.`);
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
