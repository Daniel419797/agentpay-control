import { db } from "@/lib/db"; import { handleApiError, ok } from "@/lib/api";
export const dynamic="force-dynamic";
export async function GET(){try{const rows=await db.resourceListing.findMany({where:{status:"ACTIVE"},include:{provider:true,prices:{include:{asset:true}}},orderBy:{name:"asc"}});return ok(rows.map(r=>({...r,prices:r.prices.map(p=>({...p,atomicAmount:p.atomicAmount.toString()}))})));}catch(e){return handleApiError(e)}}
