import { activeChainId, challenge, CHALLENGE_TTL_SECONDS } from "../../_lib/server";

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
    let body: { address?: string; format?: "typed-data" | "plain" } = {};
    try { body = await req.json(); } catch { return jsonResponse({ error: "Body must be JSON." }, 400); }
    const { address, format } = body;
    if (!address || typeof address !== "string") return jsonResponse({ error: "address is required" }, 400);

    const wantsTyped = format !== "plain";
    const c = challenge(address);

    const plainMessage = [
      "GameShield wants you to sign in with your Starknet account",
      `Address: ${address.toLowerCase()}`,
      `Nonce: ${c.nonce}`,
      `Expires At: ${new Date(c.expires).toISOString()}`,
    ].join("\n");

    const cookieValue = `gameshield_challenge=${encodeURIComponent(Buffer.from(c.payload).toString("base64url") + "." + c.signature)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${CHALLENGE_TTL_SECONDS}`;

    if (!wantsTyped) {
      return jsonResponse(
        { success: true, envelope: { kind: "plain" }, message: plainMessage, expires: c.expires },
        200,
        { "set-cookie": cookieValue },
      );
    }

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
    return jsonResponse(
      {
        success: true,
        envelope: { kind: "typed-data" },
        message,
        expires: c.expires,
        fallback: { kind: "plain", message: plainMessage },
      },
      200,
      { "set-cookie": cookieValue },
    );
  } catch (error: any) {
    // Never leak an empty 500 — surface the actual error so the client can recover.
    return jsonResponse({ error: error?.message ?? String(error) ?? "Challenge failed" }, 500);
  }
}
