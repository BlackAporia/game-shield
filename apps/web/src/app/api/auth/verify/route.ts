import { activeChainId, json, session, SESSION_TTL_SECONDS, verify } from "../../_lib/server";
import { createHmac } from "crypto";

export async function POST(req: Request) {
  try {
    let body: { address?: string; signature?: string[]; kind?: "typed-data" | "plain" } = {};
    try { body = await req.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
    const { address, signature, kind = "plain" } = body;
    if (!address || !Array.isArray(signature) || signature.length === 0) {
      return json({ error: "address and signature are required" }, 400);
    }

    const cookie = req.headers.get("cookie")?.match(/gameshield_challenge=([^;]+)/)?.[1];
    if (!cookie) return json({ error: "Request a challenge first" }, 401);
    const [raw, macReceived] = decodeURIComponent(cookie).split(".");
    const payload = Buffer.from(raw, "base64url").toString();
    if (createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update(payload).digest("base64url") !== macReceived) {
      return json({ error: "Invalid challenge" }, 401);
    }
    const data = JSON.parse(payload);
    if (data.expires < Date.now()) return json({ error: "Expired challenge" }, 401);
    if (data.address !== String(address).toLowerCase()) return json({ error: "Address mismatch" }, 401);

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
    if (!ok) return json({ error: "Invalid signature" }, 401);

    const response = json({ ok: true });
    response.headers.set("Set-Cookie", `gameshield_session=${session(address)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`);
    return response;
  } catch (error: any) {
    return json({ error: error?.message ?? "Verification failed" }, 400);
  }
}
