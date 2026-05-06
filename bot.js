const https = require("https");

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const FEE = 0.1;
const MIN_SPREAD = 0.3;
const CAPITALS = [10, 50, 500, 1000];
const MAX_ALERTS = 10;
const MAX_RETRIES = 5;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } 
        catch (e) { reject(new Error("Bad JSON")); }
      });
    }).on("error", reject);
  });
}

async function fetchWithRetry(fn, name) {
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try { return await fn(); } 
    catch (e) {
      if (i === MAX_RETRIES) throw e;
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

// === Use CoinGecko for prices (reliable) ===
async function fetchPrices() {
  const data = await fetchWithRetry(() => 
    get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple,cardano,avalanche-2,dogecoin,shiba-inu,polkadot,chainlink&vs_currencies=usd"), 
    "CoinGecko"
  );

  const map = {};
  Object.keys(data).forEach(coin => {
    const symbol = coin.toUpperCase().replace("-2", "");
    if (data[coin].usd) map[symbol + "USDT"] = data[coin].usd;
  });
  console.log(`CoinGecko prices: ${Object.keys(map).length}`);
  return map;
}

// Bitfinex remains
async function fetchBitfinex() {
  // ... (same as your previous Bitfinex function)
  const data = await fetchWithRetry(() => get("https://api-pub.bitfinex.com/v2/tickers?symbols=ALL"), "Bitfinex");
  // ... parsing logic same as before
  return map; // return the price map
}

// Use calcOpps, fmtOpp etc. from before, just call fetchPrices() + fetchBitfinex()

async function main() {
  const [cgPrices, bitfinex] = await Promise.all([fetchPrices(), fetchBitfinex()]);
  const opps = calcOpps(cgPrices, bitfinex, "CoinGecko", "Bitfinex");
  // ... rest same (send summary + alerts)
}

main();
