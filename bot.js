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
console.error(“Bad JSON from “ + url + “ status:” + res.statusCode);
console.error(“Preview: “ + data.substring(0, 300));
reject(new Error(“Bad JSON”));
}
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

function fetchBybit() {
return get(“https://api.bybit.com/v5/market/tickers?category=spot”).then(function(data) {
var map = {};
if (!data.result || !data.result.list) return map;
data.result.list.forEach(function(t) {
var p = parseFloat(t.lastPrice);
if (t.symbol.endsWith(“USDT”) && p > 0) map[t.symbol] = p;
});
console.log(“Bybit: “ + Object.keys(map).length + “ pairs”);
return map;
}).catch(function(e) {
console.error(“Bybit failed: “ + e.message);
return {};
});
}

function fetchGate() {
return get(“https://api.gateio.ws/api/v4/spot/tickers”).then(function(data) {
var map = {};
if (!Array.isArray(data)) return map;
data.forEach(function(t) {
var sym = t.currency_pair.replace(”_”, “”);
var p = parseFloat(t.last);
if (sym.endsWith(“USDT”) && p > 0) map[sym] = p;
});
console.log(“Gate.io: “ + Object.keys(map).length + “ pairs”);
return map;
}).catch(function(e) {
console.error(“Gate.io failed: “ + e.message);
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

var results = await Promise.all([fetchBybit(), fetchGate()]);
var bybit = results[0];
var gate = results[1];

var bybitTotal = Object.keys(bybit).length;
var gateTotal = Object.keys(gate).length;
var common = Object.keys(bybit).filter(function(s) { return gate[s]; }).length;

console.log(“Common pairs: “ + common);

if (bybitTotal === 0 || gateTotal === 0) {
console.error(“One or both APIs returned no data”);
try { await sendTG(“Scan failed: API issue. Bybit=” + bybitTotal + “ Gate=” + gateTotal); } catch(e) {}
process.exit(1);
}

var opps = calcOpps(bybit, gate, “Bybit”, “Gate.io”);

var summary = (
“<b>ARBOT SCAN</b> - “ + new Date().toUTCString() + “\n” +
“Bybit pairs: <b>” + bybitTotal + “</b>\n” +
“Gate.io pairs: <b>” + gateTotal + “</b>\n” +
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
