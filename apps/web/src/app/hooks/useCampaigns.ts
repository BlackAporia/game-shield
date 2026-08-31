"use client";
import { useCallback, useState } from "react";
import { Contract, RpcProvider, num } from "starknet";
import gameShieldClass from "../../../../../contracts/target/dev/gameshield_GameShield.contract_class.json";
import type { Campaign } from "../types";
const abi = (gameShieldClass as { abi: unknown[] }).abi;
const bool = (v: any) => typeof v === "boolean" ? v : v?.variant?.True !== undefined;
const hex = (v: string) => num.toHex(num.toBigInt(v));
export function useCampaigns(gameShieldAddress: string) {
 // UI-only local/testnet switch. Never enable this for a mainnet deployment.
 const simulateFunded = process.env.NEXT_PUBLIC_SIMULATE_FUNDED === "true";
 const [campaigns,setCampaigns]=useState<Campaign[]>([]); const [loading,setLoading]=useState(false); const [error,setError]=useState("");
 const refresh=useCallback(async()=>{ if(!gameShieldAddress||gameShieldAddress==="0x0"){setCampaigns([]);return;} setLoading(true);setError("");try { const provider=new RpcProvider({nodeUrl:process.env.NEXT_PUBLIC_STARKNET_RPC_URL!}); const c=new Contract({abi,address:gameShieldAddress,providerOrAccount:provider}); const count=Number(await c.get_campaign_count()); const values=await Promise.all(Array.from({length:count},async(_,i)=>{const id=i+1;const r:any=await c.get_campaign(id);const winnerSlotCount=Number(r.winner_slot_count);const winnerSlots=await Promise.all(Array.from({length:winnerSlotCount},async(__,slotId)=>{const slot:any=await c.get_winner_slot(id,slotId);return{slotId,amount:num.toBigInt(slot.amount),winnerAddress:hex(slot.winner_address),claimed:bool(slot.claimed),assignedAt:num.toBigInt(slot.assigned_at)};}));let description="";try{const response=await fetch(`/api/campaign/description?campaign_id=${id}`);if(response.ok)description=(await response.json()).description??"";}catch{}return {id,organizer:hex(r.organizer),token:hex(r.token),rewardAmount:num.toBigInt(r.reward_amount),deadline:num.toBigInt(r.deadline),criteriaHash:hex(r.criteria_hash),title:hex(r.title),funded:simulateFunded||bool(r.funded),assignmentGracePeriod:num.toBigInt(r.assignment_grace_period),claimExpiryWindow:num.toBigInt(r.claim_expiry_window),totalAllocated:num.toBigInt(r.total_allocated),winnerSlotCount, winnerSlots,unallocatedSwept:bool(r.unallocated_swept),refundPool:num.toBigInt(r.refund_pool),status:winnerSlotCount>0?"resolved":"active",winner:"0x0",claimed:false,description} satisfies Campaign;}));setCampaigns(values);}catch(e:any){setError(e?.message??"Failed to load campaigns.");}finally{setLoading(false);}},[gameShieldAddress,simulateFunded]);
 return {campaigns,loading,error,refresh};
}
