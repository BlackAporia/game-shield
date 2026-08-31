import { json, supabase, supabaseCount } from "../../_lib/server";

export async function GET(req: Request) {
  const campaignId = new URL(req.url).searchParams.get("campaign_id");
  const applicantAddress = new URL(req.url).searchParams.get("applicant_address");
  if (!campaignId) return json({ error: "campaign_id is required" }, 400);
  try {
    const count = await supabaseCount(`applications?campaign_id=eq.${encodeURIComponent(campaignId)}&select=id`);
    if (!applicantAddress) return json({ count });
    const matching: any[] = await supabase(`applications?campaign_id=eq.${encodeURIComponent(campaignId)}&applicant_address=eq.${encodeURIComponent(applicantAddress.toLowerCase())}&select=id&limit=1`);
    return json({ count, applied: matching.length > 0 });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
}
