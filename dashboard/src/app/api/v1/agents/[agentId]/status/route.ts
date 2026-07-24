import { z } from "zod"; import { db } from "@/lib/db"; import { handleApiError, ok } from "@/lib/api";
const schema=z.object({status:z.enum(["ACTIVE","PAUSED","ARCHIVED"])});
export async function POST(request:Request,{params}:{params:Promise<{agentId:string}>}){try{const {agentId}=await params;return ok(await db.agent.update({where:{id:agentId},data:schema.parse(await request.json())}));}catch(e){return handleApiError(e)}}
