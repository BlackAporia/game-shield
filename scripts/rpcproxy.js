#!/usr/bin/env node
// rpcproxy.js — local JSON-RPC proxy for starkli.
//
// starkli 0.4 hardcodes block tag "pending" for nonce lookup and fee
// estimation, but most public mainnet RPCs reject "pending". This proxy
// rewrites "pending" -> "latest" and forwards everything to a public RPC.
//
// Usage:
//   node scripts/rpcproxy.js            # listen on 127.0.0.1:9546
//   UPSTREAM_RPC=<url> node scripts/rpcproxy.js
const http = require("http");
const https = require("https");

const UPSTREAM = process.env.UPSTREAM_RPC || "https://rpc.starknet.lava.build";
const PORT = Number(process.env.PORT || 9546);
const HOST = "127.0.0.1";

function rewrite(v, key) {
  if (key === "block_id" && v === "pending") return "latest";
  if (key === "block_tag" && v === "pending") return "latest";
  if (Array.isArray(v)) return v.map((x) => rewrite(x));
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = rewrite(v[k], k);
    return o;
  }
  return v;
}

function fixBody(body) {
  let payload = body;
  try {
    payload = JSON.stringify(rewrite(JSON.parse(body)));
  } catch {
    /* pass through non-JSON bodies untouched */
  }
  // blanket fallback: any "pending" string left in the request becomes "latest"
  return payload.replace(/"pending"/g, '"latest"');
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = fixBody(body);
    const u = new URL(UPSTREAM);
    const r = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname || "/",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (up) => {
        let data = "";
        up.on("data", (c) => (data += c));
        up.on("end", () => {
          res.writeHead(up.statusCode || 500, { "content-type": "application/json" });
          res.end(data);
        });
      }
    );
    r.on("error", (e) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: String(e) } }));
    });
    r.write(payload);
    r.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`rpcproxy: ${HOST}:${PORT} -> ${UPSTREAM} (pending -> latest)`);
});