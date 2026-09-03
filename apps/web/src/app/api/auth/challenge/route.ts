import { activeChainId, challenge, CHALLENGE_TTL_SECONDS, json } from "../../_lib/server";

export async function POST(req: Request) {
  let body: { address?: string; format?: "typed-data" | "plain" } = {};
  try { body = await req.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
  const { address, format } = body;
  if (!address || typeof address !== "string") return json({ error: "address is required" }, 400);

  const wantsTyped = format !== "plain";
  const c = challenge(address);

  // Plain-text envelope — universally supported (Ready X refuses typed-data
  // with hex shortstring values, so we offer this path as the default for
  // wallets that signal "plain" or that fail the typed-data signing).
  const plainMessage = [
    "GameShield wants you to sign in with your Starknet account",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${c.nonce}`,
    `Expires At: ${new Date(c.expires).toISOString()}`,
  ].join("\n");

  if (!wantsTyped) {
    const response = json({ success: true, envelope: { kind: "plain" }, message: plainMessage, expires: c.expires });
    response.headers.set(
      "Set-Cookie",
      `gameshield_challenge=${encodeURIComponent(Buffer.from(c.payload).toString("base64url") + "." + c.signature)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${CHALLENGE_TTL_SECONDS}`,
    );
    return response;
  }

  // SNIP-12 typed envelope — preferred path for Braavos / Argent / Xverse.
  const message = {
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
    message: { nonce: c.nonce, expires: c.expires.toString() },
  };
  const response = json({ success: true, envelope: { kind: "typed-data" }, message, expires: c.expires, fallback: { kind: "plain", message: plainMessage } });
  response.headers.set(
    "Set-Cookie",
    `gameshield_challenge=${encodeURIComponent(Buffer.from(c.payload).toString("base64url") + "." + c.signature)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${CHALLENGE_TTL_SECONDS}`,
  );
  return response;
}
