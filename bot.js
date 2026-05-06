const https = require(“https”);

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const MEXC_FEE = 0.1;
const BYBIT_FEE = 0.1;
const MIN_SPREAD = 0.3;
const CAPITALS = [10, 50, 500, 1000];
const MAX_ALERTS = 10;

function get(url) {
return new Promise(function(resolve, reject) {
var req = https.get(url, { headers: { “User-Agent”: “ArbBot/1.0” } }, function(res) {
var data = “”;
res.on(“data”, function(c) { data += c; });
res.on(“end”, function() {
try { resolve(JSON.parse(data)); }
catch(e) { reject(new Error(“Bad JSON”)); }
});
});
req.on(“error”, reject);
req.setTimeout(15000, function() { req.destroy(); reject(new Error(“Timeout”)); });
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
var j = JSON.parse(d);
if (j.ok) resolve(j);
else reject(new Error(j.description));
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

function fetchMEXC() {
return get(“https://api.mexc.com/api/v3/ticker/price”).then(function(data) {
var map = {};
for (var i = 0; i < data.length; i++) {
var s = data[i].symbol;
var p = parseFloat(data[i].price);
if (s.endsWith(“USDT”) && p > 0) map[s] = p;
}
return map;
});
}

function fetchBybit() {
return get(“https://api.bybit.com/v5/market/tickers?category=spot”).then(function(data) {
var map = {};
var list = data.result.list;
for (var i = 0; i < list.length; i++) {
var s = list[i].symbol;
var p = parseFloat(list[i].lastPrice);
if (s.endsWith(“USDT”) && p > 0) map[s] = p;
}
return map;
});
}

function calcOpps(mexc, bybit) {
var totalFee = (MEXC_FEE + BYBIT_FEE) / 100;
var results = [];
var keys = Object.keys(mexc);

for (var i = 0; i < keys.length; i++) {
var sym = keys[i];
if (!bybit[sym]) continue;

```
var pm = mexc[sym];
var pb = bybit[sym];
var buyEx, sellEx, buyP, sellP;

if (pm < pb) {
  buyEx = "MEXC"; buyP = pm; sellEx = "Bybit"; sellP = pb;
} else {
  buyEx = "Bybit"; buyP = pb; sellEx = "MEXC"; sellP = pm;
}

var spreadPct = ((sellP - buyP) / buyP) * 100;
var netPct = spreadPct - (totalFee * 100);

if (netPct < MIN_SPREAD) continue;

var profits = CAPITALS.map(function(c) {
  return { cap: c, profit: (c * netPct / 100).toFixed(4) };
});

results.push({
  sym: sym,
  coin: sym.replace("USDT", ""),
  buyEx: buyEx, sellEx: sellEx,
  buyP: buyP, sellP: sellP,
  spreadPct: spreadPct, netPct: netPct,
  profits: profits
});
```

}

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
return “  $” + p.cap + “ capital -> +$” + p.profit + “ profit”;
}).join(”\n”);

return (
rank + “. <b>” + o.coin + “/USDT</b>\n” +
“Buy  <b>” + o.buyEx + “</b> @ $” + fmtPrice(o.buyP) + “\n” +
“Sell <b>” + o.sellEx + “</b> @ $” + fmtPrice(o.sellP) + “\n” +
“Spread: <b>” + o.spreadPct.toFixed(3) + “%</b>\n” +
“Fees: <b>-” + (MEXC_FEE + BYBIT_FEE).toFixed(2) + “%</b>\n” +
“Net profit: <b>+” + o.netPct.toFixed(3) + “%</b>\n” +
lines
);
}

async function main() {
if (!TG_TOKEN || !TG_CHAT_ID) {
console.error(“Missing TG_TOKEN or TG_CHAT_ID”);
process.exit(1);
}

console.log(“Starting scan…”);

var mexc, bybit;
try {
var results = await Promise.all([fetchMEXC(), fetchBybit()]);
mexc = results[0];
bybit = results[1];
} catch(e) {
console.error(“Fetch error: “ + e.message);
try { await sendTG(“Fetch error: “ + e.message); } catch(e2) {}
process.exit(1);
}

var opps = calcOpps(mexc, bybit);
var mexcTotal = Object.keys(mexc).length;
var bybitTotal = Object.keys(bybit).length;
var common = Object.keys(mexc).filter(function(s) { return bybit[s]; }).length;

console.log(“MEXC: “ + mexcTotal + “ Bybit: “ + bybitTotal + “ Common: “ + common + “ Opps: “ + opps.length);

var summary = (
“<b>ARBOT SCAN</b> - “ + new Date().toUTCString() + “\n” +
“MEXC pairs: <b>” + mexcTotal + “</b>\n” +
“Bybit pairs: <b>” + bybitTotal + “</b>\n” +
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
