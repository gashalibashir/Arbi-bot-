const https = require(“https”);

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const FEE = 0.1;
const MIN_SPREAD = 0.3;
const CAPITALS = [10, 50, 500, 1000];
const MAX_ALERTS = 10;

function get(url) {
return new Promise(function(resolve, reject) {
var req = https.get(url, {
headers: {
“User-Agent”: “Mozilla/5.0 (Windows NT 10.0; Win64; x64)”,
“Accept”: “application/json”
}
}, function(res) {
var data = “”;
res.on(“data”, function(c) { data += c; });
res.on(“end”, function() {
try { resolve(JSON.parse(data)); }
catch(e) {
console.error(“Bad JSON from “ + url);
console.error(“HTTP status: “ + res.statusCode);
console.error(“Headers: “ + JSON.stringify(res.headers));
console.error(“Body preview: “ + data.substring(0, 500));
reject(new Error(“Bad JSON: HTTP “ + res.statusCode));
}
});
});
req.on(“error”, function(e) {
console.error(“Request error for “ + url + “: “ + e.message);
reject(e);
});
req.setTimeout(20000, function() {
req.destroy();
reject(new Error(“Timeout: “ + url));
});
});
}

function sendTG(text) {
return new Promise(function(resolve, reject) {
var body = JSON.stringify({ chat_id: TG_CHAT_ID, text: text, parse_mode: “HTML” });
var opts = {
hostname: “api.telegram.org”,
path: “/bot” + TG_TOKEN + “/sendMessage”,
method: “POST”,
headers: {
“Content-Type”: “application/json”,
“Content-Length”: Buffer.byteLength(body)
}
};
var req = https.request(opts, function(res) {
var d = “”;
res.on(“data”, function(c) { d += c; });
res.on(“end”, function() {
try {
var j = JSON.parse(d);
if (j.ok) resolve(j);
else reject(new Error(j.description));
} catch(e) { reject(new Error(“TG parse error”)); }
});
});
req.on(“error”, reject);
req.setTimeout(10000, function() { req.destroy(); reject(new Error(“TG Timeout”)); });
req.write(body);
req.end();
});
}

function sleep(ms) {
return new Promise(function(r) { setTimeout(r, ms); });
}

// Kraken: uses AssetPairs to map internal keys -> normalised XXXUSDT symbols,
// then fetches all tickers in one call.
function fetchKraken() {
console.log(“Fetching Kraken AssetPairs…”);
return get(“https://api.kraken.com/0/public/AssetPairs”).then(function(pairsData) {
var pairMap = {};
if (pairsData.result) {
Object.keys(pairsData.result).forEach(function(key) {
var pair = pairsData.result[key];
var wsname = pair.wsname; // e.g. “XBT/USDT”
if (wsname && wsname.endsWith(”/USDT”)) {
var base = wsname.replace(”/USDT”, “”).replace(“XBT”, “BTC”);
pairMap[key] = base + “USDT”;
}
});
}
console.log(“Kraken USDT pairs found in AssetPairs: “ + Object.keys(pairMap).length);

```
console.log("Fetching Kraken Ticker...");
return get("https://api.kraken.com/0/public/Ticker").then(function(data) {
  var map = {};
  if (!data.result) {
    console.error("Kraken Ticker: no result field. Keys: " + Object.keys(data).join(", "));
    return map;
  }
  Object.keys(data.result).forEach(function(key) {
    var sym = pairMap[key];
    if (!sym) return;
    var p = parseFloat(data.result[key].c[0]);
    if (p > 0) map[sym] = p;
  });
  console.log("Kraken: " + Object.keys(map).length + " USDT pairs");
  return map;
});
```

}).catch(function(e) {
console.error(“Kraken failed: “ + e.message);
return {};
});
}

// Bitfinex: fetch all tickers, filter tXXXUST (USDT) pairs.
// index 7 = LAST_PRICE in the ticker array.
function fetchBitfinex() {
console.log(“Fetching Bitfinex tickers…”);
return get(“https://api-pub.bitfinex.com/v2/tickers?symbols=ALL”).then(function(data) {
var map = {};
if (!Array.isArray(data)) {
console.error(“Bitfinex: expected array, got: “ + typeof data);
return map;
}
data.forEach(function(ticker) {
var sym = ticker[0];
if (!sym || sym[0] !== “t”) return;
// Bitfinex uses UST for USDT; also handle USDT suffix
var isUST  = sym.endsWith(“UST”)  && !sym.includes(”:”);
var isUSDT = sym.endsWith(“USDT”) && !sym.includes(”:”);
if (!isUST && !isUSDT) return;
var p = parseFloat(ticker[7]); // LAST_PRICE
if (!p || p <= 0) return;
var base;
if (isUST)  base = sym.slice(1, -3);
if (isUSDT) base = sym.slice(1, -4);
if (!base || base.includes(“F0”)) return;
map[base + “USDT”] = p;
});
console.log(“Bitfinex: “ + Object.keys(map).length + “ USDT pairs”);
return map;
}).catch(function(e) {
console.error(“Bitfinex failed: “ + e.message);
return {};
});
}

function calcOpps(ex1, ex2, name1, name2) {
var totalFee = (FEE + FEE) / 100;
var results = [];
Object.keys(ex1).forEach(function(sym) {
if (!ex2[sym]) return;
var p1 = ex1[sym];
var p2 = ex2[sym];
var buyEx, sellEx, buyP, sellP;
if (p1 < p2) {
buyEx = name1; buyP = p1; sellEx = name2; sellP = p2;
} else {
buyEx = name2; buyP = p2; sellEx = name1; sellP = p1;
}
var spreadPct = ((sellP - buyP) / buyP) * 100;
var netPct = spreadPct - (totalFee * 100);
if (netPct < MIN_SPREAD) return;
var profits = CAPITALS.map(function(c) {
return { cap: c, profit: (c * netPct / 100).toFixed(4) };
});
results.push({
coin: sym.replace(“USDT”, “”),
buyEx: buyEx, sellEx: sellEx,
buyP: buyP, sellP: sellP,
spreadPct: spreadPct, netPct: netPct,
profits: profits
});
});
results.sort(function(a, b) { return b.netPct - a.netPct; });
return results;
}

function fmtPrice(n) {
if (n < 0.0001) return n.toExponential(4);
if (n < 1) return n.toFixed(6);
if (n < 1000) return n.toFixed(4);
return n.toFixed(2);
}

function fmtOpp(o, rank) {
var lines = o.profits.map(function(p) {
return “  $” + p.cap + “ -> +$” + p.profit;
}).join(”\n”);
return (
rank + “. <b>” + o.coin + “/USDT</b>\n” +
“Buy  <b>” + o.buyEx + “</b> @ $” + fmtPrice(o.buyP) + “\n” +
“Sell <b>” + o.sellEx + “</b> @ $” + fmtPrice(o.sellP) + “\n” +
“Spread: <b>” + o.spreadPct.toFixed(3) + “%</b>\n” +
“Fees: <b>-” + (FEE + FEE).toFixed(2) + “%</b>\n” +
“Net: <b>+” + o.netPct.toFixed(3) + “%</b>\n” +
lines
);
}

async function main() {
if (!TG_TOKEN || !TG_CHAT_ID) {
console.error(“Missing TG_TOKEN or TG_CHAT_ID”);
process.exit(1);
}

console.log(“Starting scan…”);

var results = await Promise.all([fetchKraken(), fetchBitfinex()]);
var kraken = results[0];
var bitfinex = results[1];

var krakenTotal = Object.keys(kraken).length;
var bitfinexTotal = Object.keys(bitfinex).length;
var common = Object.keys(kraken).filter(function(s) { return bitfinex[s]; }).length;

console.log(“Kraken pairs: “ + krakenTotal);
console.log(“Bitfinex pairs: “ + bitfinexTotal);
console.log(“Common pairs: “ + common);

if (krakenTotal === 0 || bitfinexTotal === 0) {
console.error(“One or both APIs returned no data”);
try { await sendTG(“Scan failed: API issue. Kraken=” + krakenTotal + “ Bitfinex=” + bitfinexTotal); } catch(e) {}
process.exit(1);
}

var opps = calcOpps(kraken, bitfinex, “Kraken”, “Bitfinex”);

var summary = (
“<b>ARBOT SCAN</b> - “ + new Date().toUTCString() + “\n” +
“Kraken pairs: <b>” + krakenTotal + “</b>\n” +
“Bitfinex pairs: <b>” + bitfinexTotal + “</b>\n” +
“Common: <b>” + common + “</b>\n” +
“Opportunities: <b>” + opps.length + “</b> (min “ + MIN_SPREAD + “% net)\n”
);

try { await sendTG(summary); } catch(e) { console.error(“TG error: “ + e.message); }
await sleep(500);

var toSend = opps.slice(0, MAX_ALERTS);
for (var i = 0; i < toSend.length; i++) {
try {
await sendTG(fmtOpp(toSend[i], i + 1));
console.log(“Sent: “ + toSend[i].coin);
} catch(e) {
console.error(“TG error: “ + e.message);
}
await sleep(400);
}

console.log(“Done. Sent “ + toSend.length + “ alerts.”);
}

main();
