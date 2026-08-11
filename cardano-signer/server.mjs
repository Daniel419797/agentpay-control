import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { buildSignedAdaTransaction, publicKeyFromSeed, signHashWithSeed, verifyEd25519 } from "./cardano.mjs";

const MAX_BODY_BYTES = 64 * 1024;

function required(name, value = process.env[name]) { if (!value) throw new Error(`${name}_REQUIRED`); return value; }
function numberEnv(name, fallback, min, max) { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}_INVALID`); return value; }
function safeEqual(a,b){const ah=createHash("sha256").update(a).digest(),bh=createHash("sha256").update(b).digest();return timingSafeEqual(ah,bh);}
function json(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{"content-type":"application/json","content-length":Buffer.byteLength(body),"cache-control":"no-store"});res.end(body);}
function networkName(value){if(value==="preprod")return"cardano:preprod";if(value==="mainnet")return"cardano:mainnet";throw new Error("CARDANO_NETWORK_INVALID");}

function configFromEnv(){
  const appEnv=process.env.APP_ENV??"development";
  if(!["development","test","production"].includes(appEnv))throw new Error("APP_ENV_INVALID");
  const network=networkName(process.env.CARDANO_NETWORK??"preprod");
  const cfg={appEnv,network,payerAddress:required("CARDANO_PAYER_ADDRESS"),blockfrostUrl:required("CARDANO_BLOCKFROST_URL").replace(/\/$/,""),blockfrostProjectId:required("CARDANO_BLOCKFROST_PROJECT_ID"),apiKey:required("CARDANO_SIGNER_API_KEY"),port:numberEnv("PORT",8791,1,65535),minOutput:BigInt(process.env.CARDANO_MIN_OUTPUT_LOVELACE??"1000000"),minChange:BigInt(process.env.CARDANO_MIN_CHANGE_LOVELACE??"2000000"),maxInputs:numberEnv("CARDANO_MAX_INPUTS",20,1,64),remoteSignerUrl:process.env.CARDANO_ED25519_SIGNER_URL,remoteSignerApiKey:process.env.CARDANO_ED25519_SIGNER_API_KEY,publicKeyHex:process.env.CARDANO_PAYMENT_PUBLIC_KEY_HEX,seedHex:process.env.CARDANO_SIGNING_SEED_HEX};
  if(cfg.apiKey.length<32)throw new Error("CARDANO_SIGNER_API_KEY_TOO_SHORT");
  if(cfg.appEnv==="production"){
    if(network!=="cardano:preprod"&&network!=="cardano:mainnet")throw new Error("CARDANO_NETWORK_INVALID");
    if(new URL(cfg.blockfrostUrl).protocol!=="https:")throw new Error("CARDANO_BLOCKFROST_URL_HTTPS_REQUIRED");
    if(!cfg.remoteSignerUrl||!cfg.remoteSignerApiKey||!cfg.publicKeyHex)throw new Error("CARDANO_REMOTE_ED25519_SIGNER_REQUIRED");
    if(new URL(cfg.remoteSignerUrl).protocol!=="https:")throw new Error("CARDANO_ED25519_SIGNER_URL_HTTPS_REQUIRED");
    if(cfg.remoteSignerApiKey.length<32)throw new Error("CARDANO_ED25519_SIGNER_API_KEY_TOO_SHORT");
    if(cfg.seedHex)throw new Error("CARDANO_RAW_SIGNING_SEED_PROHIBITED_IN_PRODUCTION");
    if(safeEqual(cfg.apiKey,cfg.remoteSignerApiKey))throw new Error("CARDANO_SIGNER_CAPABILITY_KEYS_MUST_BE_DISTINCT");
  } else if(!cfg.seedHex&&!cfg.remoteSignerUrl){throw new Error("CARDANO_LOCAL_OR_REMOTE_SIGNER_REQUIRED");}
  if(cfg.seedHex&&!/^[0-9a-fA-F]{64}$/.test(cfg.seedHex))throw new Error("CARDANO_SIGNING_SEED_INVALID");
  if(cfg.publicKeyHex&&!/^[0-9a-fA-F]{64}$/.test(cfg.publicKeyHex))throw new Error("CARDANO_PAYMENT_PUBLIC_KEY_INVALID");
  return cfg;
}

async function readJson(req){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>MAX_BODY_BYTES)throw new Error("REQUEST_BODY_TOO_LARGE");chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
async function bfJson(cfg,path){const response=await fetch(`${cfg.blockfrostUrl}${path}`,{headers:{project_id:cfg.blockfrostProjectId,accept:"application/json"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error(`CARDANO_PROVIDER_${response.status}`);return response.json();}
async function addressUtxos(cfg,address){const rows=[];for(let page=1;page<=10;page++){const batch=await bfJson(cfg,`/addresses/${encodeURIComponent(address)}/utxos?count=100&page=${page}&order=asc`);if(!Array.isArray(batch))throw new Error("CARDANO_UTXO_RESPONSE_INVALID");rows.push(...batch);if(batch.length<100)return rows;}throw new Error("CARDANO_UTXO_SET_TOO_LARGE");}
function protocolParams(value){if(!value||typeof value!=="object")throw new Error("CARDANO_PROTOCOL_PARAMETERS_INVALID");const a=String(value.min_fee_a??""),b=String(value.min_fee_b??"");if(!/^\d+$/.test(a)||!/^\d+$/.test(b))throw new Error("CARDANO_PROTOCOL_PARAMETERS_INVALID");return{min_fee_a:a,min_fee_b:b};}
async function publicKey(cfg){if(cfg.publicKeyHex)return Buffer.from(cfg.publicKeyHex,"hex");if(cfg.seedHex)return publicKeyFromSeed(cfg.seedHex);throw new Error("CARDANO_PAYMENT_PUBLIC_KEY_REQUIRED");}
async function signBodyHash(cfg,hash){if(cfg.seedHex)return signHashWithSeed(cfg.seedHex,hash);const response=await fetch(cfg.remoteSignerUrl,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${cfg.remoteSignerApiKey}`},body:JSON.stringify({algorithm:"Ed25519",messageHex:Buffer.from(hash).toString("hex"),purpose:"cardano-transaction-body"}),redirect:"error",signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`CARDANO_REMOTE_SIGNER_${response.status}`);const payload=await response.json();const signatureHex=typeof payload?.signatureHex==="string"?payload.signatureHex:"";if(!/^[0-9a-fA-F]{128}$/.test(signatureHex))throw new Error("CARDANO_REMOTE_SIGNATURE_INVALID");const signature=Buffer.from(signatureHex,"hex"),key=await publicKey(cfg);if(!verifyEd25519(key,hash,signature))throw new Error("CARDANO_REMOTE_SIGNATURE_INVALID");return signature;}

function validateRequest(body,cfg){if(!body||typeof body!=="object")throw new Error("CARDANO_SIGN_REQUEST_INVALID");const requirement=body.paymentRequirements;if(!requirement||typeof requirement!=="object")throw new Error("CARDANO_PAYMENT_REQUIREMENT_INVALID");if(body.network!==cfg.network||requirement.network!==cfg.network)throw new Error("CARDANO_NETWORK_MISMATCH");if(body.payerAddress!==cfg.payerAddress)throw new Error("CARDANO_PAYER_MISMATCH");if(body.submissionMode!=="server")throw new Error("CARDANO_SUBMISSION_MODE_MISMATCH");if(requirement.scheme!=="exact"||requirement.asset!=="lovelace"||!/^\d+$/.test(String(requirement.amount??""))||!requirement.payTo)throw new Error("CARDANO_PAYMENT_REQUIREMENT_INVALID");const timeout=Number(requirement.maxTimeoutSeconds);if(!Number.isInteger(timeout)||timeout<2||timeout>3600)throw new Error("CARDANO_TIMEOUT_INVALID");return{requirement,timeout};}

export function createSignerServer(cfg=configFromEnv()){
  return createServer(async(req,res)=>{
    try{
      if(req.method==="GET"&&req.url==="/health")return json(res,200,{status:"ok",network:cfg.network,custody:cfg.appEnv==="production"?"remote-ed25519":"isolated-test-signer"});
      if(req.method!=="POST"||!(req.url==="/sign"||req.url==="/"))return json(res,404,{code:"NOT_FOUND"});
      const auth=req.headers.authorization;if(!auth?.startsWith("Bearer ")||!safeEqual(auth.slice(7),cfg.apiKey))return json(res,401,{code:"UNAUTHORIZED"});
      const body=await readJson(req),{requirement,timeout}=validateRequest(body,cfg);
      const [latest,params,utxos,key]=await Promise.all([bfJson(cfg,"/blocks/latest"),bfJson(cfg,"/epochs/latest/parameters"),addressUtxos(cfg,cfg.payerAddress),publicKey(cfg)]);
      if(!Number.isInteger(latest?.slot)||latest.slot<0)throw new Error("CARDANO_LATEST_SLOT_UNAVAILABLE");
      const signed=await buildSignedAdaTransaction({network:cfg.network,payerAddress:cfg.payerAddress,payeeAddress:requirement.payTo,amountLovelace:String(requirement.amount),maxTimeoutSeconds:timeout,latestSlot:latest.slot,protocolParameters:protocolParams(params),utxos,publicKey:key,signBodyHash:(hash)=>signBodyHash(cfg,hash),minOutputLovelace:cfg.minOutput,minChangeLovelace:cfg.minChange,maxInputs:cfg.maxInputs});
      return json(res,200,{transaction:signed.transaction,nonce:signed.nonce,transactionId:signed.transactionId});
    }catch(error){const code=error instanceof Error&&error.message.startsWith("CARDANO_")?error.message:"CARDANO_SIGNING_FAILED";const status=code==="REQUEST_BODY_TOO_LARGE"?413:code.includes("PROVIDER_")||code.includes("REMOTE_SIGNER_")?502:422;console.error(JSON.stringify({event:"cardano_signing_request_failed",code}));return json(res,status,{code});}
  });
}

if(import.meta.url===`file://${process.argv[1]}`){const cfg=configFromEnv();createSignerServer(cfg).listen(cfg.port,"0.0.0.0",()=>console.log(JSON.stringify({event:"cardano_signer_listening",port:cfg.port,network:cfg.network})));}

export { configFromEnv };
