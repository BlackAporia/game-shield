import { activeChainId, session, SESSION_TTL_SECONDS, verify } from "../../_lib/server";
import { createHmac } from "crypto";

const jsonResponse = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  });

export async function POST(req: Request) {
  try {
    let body: { address?: string; signature?: string[]; kind?: "typed-data" | "plain" } = {};
    try { body = await req.json(); } catch { return jsonResponse({ error: "Body must be JSON." }, 400); }
    const { address, signature, kind = "plain" } = body;
    if (!address || !Array.isArray(signature) || signature.length === 0) {
      return jsonResponse({ error: "address and signature are required" }, 400);
    }

    const cookie = req.headers.get("cookie")?.match(/gameshield_challenge=([^;]+)/)?.[1];
    if (!cookie) return jsonResponse({ error: "Request a challenge first" }, 401);
    const [raw, macReceived] = decodeURIComponent(cookie).split(".");
    const payload = Buffer.from(raw, "base64url").toString();
    if (createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update(payload).digest("base64url") !== macReceived) {
      return jsonResponse({ error: "Invalid challenge" }, 401);
    }
    const data = JSON.parse(payload);
    if (data.expires < Date.now()) return jsonResponse({ error: "Expired challenge" }, 401);
    if (data.address !== String(address).toLowerCase()) return jsonResponse({ error: "Address mismatch" }, 401);

    let message: unknown;
    if (kind === "typed-data") {
      message = {
        domain: { name: "GameShield", version: "1", chainId: activeChainId() },
        primaryType: "Challenge",
        types: {
          StarkNetDomain: [
            { name: "name", type: "shortstring" },
            { name: "version", type: "shortstring" },
            { name: "chainId", type: "shortstring" },
          ],
          Challenge: [
            { name: "nonce", type: "shortstring" },
            { name: "expires", type: "u128" },
          ],
        },
        message: { nonce: data.nonce, expires: data.expires.toString() },
      };
    } else {
      message = [
        "GameShield wants you to sign in with your Starknet account",
        `Address: ${data.address}`,
        `Nonce: ${data.nonce}`,
        `Expires At: ${new Date(data.expires).toISOString()}`,
      ].join("\n");
    }

    const ok = await verify(address, signature, message);
    if (!ok) return jsonResponse({ error: "Invalid signature" }, 401);

    const cookieValue = `gameshield_session=${session(address)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
    return jsonResponse({ ok: true }, 200, { "set-cookie": cookieValue });
  } catch (error: any) {
    return jsonResponse({ error: error?.message ?? "Verification failed" }, 400);
  }
}
