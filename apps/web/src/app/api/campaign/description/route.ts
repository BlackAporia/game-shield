import { campaignForOrganizer, json, readSession, supabase } from "../../_lib/server";

const sessionFrom = (req: Request) => readSession(req.headers.get("cookie")?.match(/gameshield_session=([^;]+)/)?.[1]);

export async function GET(req: Request) {
  const campaignId = new URL(req.url).searchParams.get("campaign_id");
  if (!campaignId) return json({ error: "campaign_id is required" }, 400);
  try {
    const rows: any[] = await supabase(`campaign_descriptions?campaign_id=eq.${encodeURIComponent(campaignId)}&select=campaign_id,description&limit=1`);
    return json({ campaign_id: campaignId, description: rows[0]?.description ?? "" });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
}

export async function POST(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "Verified session required" }, 401);
  try {
    const { campaign_id, description } = await req.json();
    if (!campaign_id || typeof description !== "string") return json({ error: "campaign_id and description are required" }, 400);
    await campaignForOrganizer(String(campaign_id), session.address);
    await supabase("campaign_descriptions", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ campaign_id: String(campaign_id), description: description.slice(0, 2000), organizer: session.address }),
    });
    return json({ success: true, campaign_id: String(campaign_id) });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : String(e);
    console.error("[campaign-description]", e);
    return json({ error: msg }, msg.includes("organizer") ? 403 : 500);
  }
}
