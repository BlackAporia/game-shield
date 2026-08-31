import { activeChainId, json, session, SESSION_TTL_SECONDS, verify } from "../../_lib/server";
import { createHmac } from "crypto";

export async function POST(req: Request) {
  try {
    const { address, signature } = await req.json();
    const cookie = req.headers.get("cookie")?.match(/gameshield_challenge=([^;]+)/)?.[1];
    if (!cookie) return json({ error: "Request a challenge first" }, 401);
    const [raw, mac] = decodeURIComponent(cookie).split(".");
    const payload = Buffer.from(raw, "base64url").toString();
    if (createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update(payload).digest("base64url") !== mac) return json({ error: "Invalid challenge" }, 401);
    const data = JSON.parse(payload);
    if (data.expires < Date.now() || data.address !== String(address).toLowerCase()) return json({ error: "Expired challenge" }, 401);
    const message = {
      domain: { name: "GameShield", version: "1", chainId: activeChainId() },
      primaryType: "Challenge",
      types: {
        StarkNetDomain: [{ name: "name", type: "shortstring" }, { name: "version", type: "shortstring" }, { name: "chainId", type: "shortstring" }],
        Challenge: [{ name: "nonce", type: "shortstring" }, { name: "expires", type: "u128" }],
      },
      message: { nonce: data.nonce, expires: data.expires.toString() },
    };
    if (!await verify(address, signature, message)) return json({ error: "Invalid signature" }, 401);
    const response = json({ ok: true });
    response.headers.set("Set-Cookie", `gameshield_session=${session(address)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`);
    return response;
  } catch (error: any) {
    return json({ error: error.message }, 400);
  }
}
