const https = require("https");

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        try { resolve(JSON.parse(data)); } catch { reject(new Error("Bad JSON")); }
      });
    }).on("error", reject);
  });
}

async function main() {
  try {
    // Test simple ping first
    await get("https://api.coingecko.com/api/v3/ping");
    console.log("✅ CoinGecko OK");

    const data = await get("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=100&page=1");
    console.log("✅ Loaded", data.length, "coins");

    await new Promise(r => https.request({
      hostname: "api.telegram.org",
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, r).end(JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: `✅ ARBOT Test Successful at ${new Date().toUTCString()}`
    })));

    console.log("✅ Sent Telegram message");
  } catch (e) {
    console.error("❌ Failed:", e.message);
    process.exit(1);
  }
}

main();
