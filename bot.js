const https = require("https");

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const FEE = 0.1;
const MIN_SPREAD = 0.3;
const CAPITALS = [10, 50, 500, 1000];
const MAX_ALERTS = 10;
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT = 45000; // 45 seconds

// Enhanced get function with full diagnostics
function get(url) {
  return new Promise((resolve, reject) => {
    console.log(`→ Requesting: ${url}`);

    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Encoding": "identity", // Disable compression to avoid issues
        "Cache-Control": "no-cache"
      }
    }, (res) => {
      console.log(`← Response from ${url}: Status ${res.statusCode} | Headers: ${JSON.stringify(res.headers)}`);

      let data = "";

      res.on("data", chunk => { 
        data += chunk; 
        // Log progress for large responses
        if (data.length % 50000 === 0) console.log(`Received ${data.length} bytes so far...`);
      });

      res.on("end", () => {
        console.log(`Response ended. Total bytes: ${data.length}`);

        if (res.statusCode !== 200) {
          console.error(`❌ Bad status ${res.statusCode}`);
          console.error("Body preview:", data.substring(0, 1500));
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        try {
          const parsed = JSON.parse(data);
          console.log(`✅ Successfully parsed JSON (${Object.keys(parsed).length} top-level keys)`);
          resolve(parsed);
        } catch (e) {
          console.error("❌ JSON Parse FAILED");
          console.error("Error:", e.message);
          console.error("Body preview (first 1500 chars):");
          console.error(data.substring(0, 1500));
          console.error("Body end preview:");
          console.error(data.substring(Math.max(0, data.length - 500)));
          reject(new Error(`JSON parse failed: ${e.message}`));
        }
      });
    });

    req.on("error", (e) => {
      console.error(`❌ Request error: ${e.message}`);
      reject(e);
    });

    req.setTimeout(REQUEST_TIMEOUT, () => {
      console.error(`⏰ Timeout after ${REQUEST_TIMEOUT}ms`);
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

async function fetchWithRetry(fn, name) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n🔄 ${name} attempt ${attempt}/${MAX_RETRIES}`);
      return await fn();
    } catch (e) {
      console.warn(`⚠️ ${name} attempt ${attempt} failed: ${e.message}`);
      if (attempt === MAX_RETRIES) throw e;
      const delay = 2000 * attempt;
      console.log(`Waiting ${delay}ms before retry...`);
      await sleep(delay);
    }
  }
}

// Kraken fetch
async function fetchKraken() {
  // First get pairs
  const pairsData = await fetchWithRetry(() => get("https://api.kraken.com/0/public/AssetPairs"), "Kraken AssetPairs");

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
  console.log(`Kraken USDT pairs mapped: ${Object.keys(pairMap).length}`);

  // Then ticker
  const tickerData = await fetchWithRetry(() => get("https://api.kraken.com/0/public/Ticker"), "Kraken Ticker");

  const map = {};
  if (tickerData.result) {
    Object.keys(tickerData.result).forEach(key => {
      const sym = pairMap[key];
      if (sym) {
        const p = parseFloat(tickerData.result[key].c[0]);
        if (p > 0) map[sym] = p;
      }
    });
  }
  console.log(`Kraken final USDT prices: ${Object.keys(map).length}`);
  return map;
}

// Bitfinex fetch
async function fetchBitfinex() {
  const data = await fetchWithRetry(() => get("https://api-pub.bitfinex.com/v2/tickers?symbols=ALL"), "Bitfinex");

  const map = {};
  if (!Array.isArray(data)) {
    console.error("Bitfinex returned non-array");
    return map;
  }

  data.forEach(ticker => {
    const sym = ticker[0];
    if (!sym || typeof sym !== "string" || !sym.startsWith("t")) return;

    const isUST = sym.endsWith("UST") && !sym.includes(":");
    const isUSDT = sym.endsWith("USDT") && !sym.includes(":");

    if (!isUST && !isUSDT) return;

    const p = parseFloat(ticker[7]);
    if (p <= 0) return;

    let base = isUST ? sym.slice(1, -3) : sym.slice(1, -4);
    if (base && !base.includes("F0") && base.length > 1) {
      map[base + "USDT"] = p;
    }
  });

  console.log(`Bitfinex USDT prices: ${Object.keys(map).length}`);
  return map;
}

// Rest of the functions remain the same
function calcOpps(ex1, ex2, name1, name2) { /* ... same as before ... */ }
function fmtPrice(n) { /* ... same ... */ }
function fmtOpp(o, rank) { /* ... same ... */ }

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendTG(text) {
  // same as before
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
          j.ok ? resolve(j) : reject(new Error(j.description || "TG error"));
        } catch (e) { reject(new Error("TG parse error")); }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("TG Timeout")); });
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    console.error("Missing Telegram credentials");
    process.exit(1);
  }

  console.log("🚀 Starting ARBOT scan...");

  let kraken = {}, bitfinex = {};
  try {
    [kraken, bitfinex] = await Promise.all([
      fetchWithRetry(fetchKraken, "Full Kraken"),
      fetchWithRetry(fetchBitfinex, "Full Bitfinex")
    ]);
  } catch (e) {
    console.error("💥 Critical failure:", e.message);
    try {
      await sendTG(`🚨 ARBOT FAILED\n${new Date().toUTCString()}\n${e.message}`);
    } catch (_) {}
    process.exit(1);
  }

  const krakenTotal = Object.keys(kraken).length;
  const bitfinexTotal = Object.keys(bitfinex).length;
  const common = Object.keys(kraken).filter(s => bitfinex[s]).length;

  console.log(`Summary: Kraken=${krakenTotal} | Bitfinex=${bitfinexTotal} | Common=${common}`);

  if (krakenTotal === 0 || bitfinexTotal === 0) {
    await sendTG(`🚨 SCAN FAILED - No data received`);
    process.exit(1);
  }

  const opps = calcOpps(kraken, bitfinex, "Kraken", "Bitfinex");

  const summary = `<b>ARBOT SCAN</b> - ${new Date().toUTCString()}\nKraken: <b>${krakenTotal}</b> | Bitfinex: <b>${bitfinexTotal}</b>\nCommon: <b>${common}</b>\nOpps: <b>${opps.length}</b>`;

  await sendTG(summary);
  await sleep(600);

  const toSend = opps.slice(0, MAX_ALERTS);
  for (let i = 0; i < toSend.length; i++) {
    await sendTG(fmtOpp(toSend[i], i + 1));
    await sleep(500);
  }

  console.log("✅ Scan completed successfully.");
}

main().catch(err => {
  console.error("Unhandled crash:", err);
  process.exit(1);
});
