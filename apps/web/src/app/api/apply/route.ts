import { json, supabase } from "../_lib/server";

const isUniqueViolation = (error: unknown) => /"code"\s*:\s*"23505"/.test(error instanceof Error ? error.message : String(error));

export async function POST(req: Request) {
  try {
    const { campaign_id, applicant_address } = await req.json();
    if (!campaign_id || !applicant_address) return json({ error: "campaign_id and applicant_address are required" }, 400);
    await supabase("applications", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ campaign_id, applicant_address: applicant_address.toLowerCase() }) });
    return json({ ok: true });
  } catch (error: any) {
    if (isUniqueViolation(error)) return json({ ok: true, already_applied: true });
    return json({ error: error.message ?? "Could not submit application." }, 500);
  }
}
