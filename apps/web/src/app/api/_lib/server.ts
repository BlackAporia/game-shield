import { createHmac, randomBytes } from "crypto";
import { Contract, num, RpcProvider, verifyMessageInStarknet } from "starknet";
import gameShieldClass from "../../../../../../contracts/target/dev/gameshield_GameShield.contract_class.json";

const url=(process.env.SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, ""), key=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const gameShieldAbi=(gameShieldClass as {abi:unknown[]}).abi;
export const activeChainId=()=>process.env.NEXT_PUBLIC_STARKNET_RPC_URL?.toLowerCase().includes("sepolia")?"SN_SEPOLIA":"SN_MAIN";
export const REFUND_SLOT_ID=4294967295;
export const CHALLENGE_TTL_SECONDS=600;
export const SESSION_TTL_SECONDS=3600;
const gameShieldAddress=()=>process.env.NEXT_PUBLIC_GAMESHIELD_CONTRACT_ADDRESS ?? "0x0";
export const json=(body:unknown,status=200)=>Response.json(body,{status});
export async function supabase(path:string,init:RequestInit={}){const r=await fetch(`${url}/rest/v1/${path}`,{...init,headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",...(init.headers??{})}});if(!r.ok)throw Error(await r.text());const text=await r.text();return text?JSON.parse(text):null;}
export async function supabaseCount(path:string){const r=await fetch(`${url}/rest/v1/${path}`,{method:"HEAD",headers:{apikey:key,Authorization:`Bearer ${key}`,Prefer:"count=exact",Range:"0-0"}});if(!r.ok)throw Error(await r.text());const range=r.headers.get("content-range")?.split("/")[1];return range&&range!=="*"?Number(range):0;}
const secret=()=>process.env.SUPABASE_SERVICE_ROLE_KEY!;
const mac=(text:string)=>createHmac("sha256",secret()).update(text).digest("base64url");
const generateNonce=()=>{const nonce=randomBytes(15).toString("hex");console.log(`[SIWE] nonce length: ${nonce.length}`);return nonce;};
export const challenge=(address:string)=>{const nonce=generateNonce(),expires=Date.now()+CHALLENGE_TTL_SECONDS*1_000;const payload=JSON.stringify({address:address.toLowerCase(),nonce,expires});return{nonce,expires,payload,signature:mac(payload)};};
export const session=(address:string)=>{const payload=JSON.stringify({address:address.toLowerCase(),expires:Date.now()+SESSION_TTL_SECONDS*1_000});return `${Buffer.from(payload).toString("base64url")}.${mac(payload)}`;};
export const readSession=(cookie:string|undefined)=>{if(!cookie)return null;const [raw,sig]=cookie.split(".");if(!raw||sig!==mac(Buffer.from(raw,"base64url").toString()))return null;const data=JSON.parse(Buffer.from(raw,"base64url").toString());return data.expires>Date.now()?data:null;};
const isUndeployedAccountError = (error: unknown) => /contract\s+not\s+found|contract\s+does\s+not\s+exist|account[^\n]*not\s+deployed|class\s+hash[^\n]*not\s+found/i.test(String((error as any)?.message ?? error));
export async function verify(address:string,signature:string[],message:any){
  try { return await verifyMessageInStarknet(new RpcProvider({nodeUrl:process.env.NEXT_PUBLIC_STARKNET_RPC_URL!}),message,signature,address); }
  catch (error) {
    if (isUndeployedAccountError(error)) throw Error("Your account isn't deployed on mainnet yet. Send any small transaction from this wallet (like shielding some STRK, or a tiny transfer) to activate it, then try connecting again.");
    throw error;
  }
}
export async function campaignForOrganizer(campaignId:string,address:string){
  const provider=new RpcProvider({nodeUrl:process.env.NEXT_PUBLIC_STARKNET_RPC_URL!});
  const contract=new Contract({abi:gameShieldAbi,address:gameShieldAddress(),providerOrAccount:provider});
  const campaign:any=await contract.get_campaign(campaignId);
  if(BigInt(campaign.organizer.toString())!==BigInt(address))throw Error("Authenticated wallet is not this campaign's organizer");
  return { organizer: num.toHex(campaign.organizer) };
}
export const felt=()=>`0x${randomBytes(31).toString("hex")}`;
