import { db } from "@/lib/db"; import { handleApiError, ok } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET(){try{return ok(await db.asset.findMany({where:{verified:true},select:{id:true,network:true,type:true,symbol:true,name:true,decimals:true,hederaTokenId:true}}));}catch(e){return handleApiError(e)}}
