import { activeChainId, challenge, CHALLENGE_TTL_SECONDS, json } from "../../_lib/server";

export async function POST(req: Request) {
  const { address } = await req.json();
  if (!address) return json({ error: "address is required" }, 400);
  const c = challenge(address);
  console.log(`[SIWE] challenge nonce length: ${c.nonce.length}`);
  if (c.nonce.length > 30) return json({ error: "Generated SIWE nonce exceeds shortstring limit" }, 500);
  const message = {
    domain: { name: "GameShield", version: "1", chainId: activeChainId() },
    primaryType: "Challenge",
    types: {
      StarkNetDomain: [{ name: "name", type: "shortstring" }, { name: "version", type: "shortstring" }, { name: "chainId", type: "shortstring" }],
      Challenge: [{ name: "nonce", type: "shortstring" }, { name: "expires", type: "u128" }],
    },
    message: { nonce: c.nonce, expires: c.expires.toString() },
  };
  const response = json({ message, expires: c.expires });
  response.headers.set("Set-Cookie", `gameshield_challenge=${encodeURIComponent(Buffer.from(c.payload).toString("base64url") + "." + c.signature)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${CHALLENGE_TTL_SECONDS}`);
  return response;
}
