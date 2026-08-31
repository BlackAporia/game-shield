import { campaignForOrganizer, json, readSession } from "../../_lib/server";

const sessionFrom = (req: Request) => readSession(req.headers.get("cookie")?.match(/gameshield_session=([^;]+)/)?.[1]);

export async function POST(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "Verified session required" }, 401);

  try {
    const { campaign_id, splits } = await req.json();
    if (!campaign_id || !Array.isArray(splits) || !splits.length) return json({ error: "campaign_id and splits are required" }, 400);
    await campaignForOrganizer(String(campaign_id), session.address);
    const rows = splits.map((split: any) => {
      return {
        campaign_id: String(campaign_id), winner_address: String(split.winner_address).toLowerCase(),
        amount: String(split.amount),
      };
    });
    // Winner slots are authoritative on-chain. Do not persist the legacy
    // secret-based `winners` row: its old NOT NULL secret column is not part
    // of the public-address payout design.
    return json(rows.map(({ amount, winner_address }) => ({ amount, winner_address })));
  } catch (error: any) {
    return json({ error: error.message }, error.message.includes("organizer") ? 403 : 500);
  }
}
