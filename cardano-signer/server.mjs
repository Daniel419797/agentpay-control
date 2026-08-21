import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { blake2b, buildSignedCardanoTransaction, buildUnsignedCardanoTransaction, decodeAddress, parseAssetUnit, paymentCredential, publicKeyFromSeed, signHashWithSeed, verifyEd25519 } from "./cardano.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function required(name, value = process.env[name]) { if (!value) throw new Error(`${name}_REQUIRED`); return value; }
function numberEnv(name, fallback, min, max) { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}_INVALID`); return value; }
function bigintEnv(name,fallback,min,max){const raw=process.env[name]??fallback;if(!/^\d+$/.test(raw))throw new Error(`${name}_INVALID`);const value=BigInt(raw);if(value<min||value>max)throw new Error(`${name}_INVALID`);return value;}
function safeEqual(a,b){const left=Buffer.from(String(a),"utf8"),right=Buffer.from(String(b),"utf8");return left.length===right.length&&timingSafeEqual(left,right);}
function json(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{"content-type":"application/json","content-length":Buffer.byteLength(body),"cache-control":"no-store"});res.end(body);}
function networkName(value){if(value==="preprod")return"cardano:preprod";if(value==="mainnet")return"cardano:mainnet";throw new Error("CARDANO_NETWORK_INVALID");}
function managedMasterKey(value){if(!value)return undefined;if(!/^[A-Za-z0-9_-]{43}$/.test(value))throw new Error("CARDANO_MANAGED_AGENT_MASTER_KEY_INVALID");const decoded=Buffer.from(value,"base64url");if(decoded.length!==32)throw new Error("CARDANO_MANAGED_AGENT_MASTER_KEY_INVALID");return decoded;}

function configFromEnv(){
  const appEnv=process.env.APP_ENV??"development";
  if(!["development","test","production"].includes(appEnv))throw new Error("APP_ENV_INVALID");
  const network=networkName(process.env.CARDANO_NETWORK??"preprod");
  const signingMode=process.env.CARDANO_SIGNING_MODE??"managed";
  if(!["managed","unsigned-only"].includes(signingMode))throw new Error("CARDANO_SIGNING_MODE_INVALID");
  const usdcxAssetId=process.env.CARDANO_USDCX_ASSET_ID?.trim().toLowerCase();
  if(usdcxAssetId)parseAssetUnit(usdcxAssetId);
  const payerAddress=process.env.CARDANO_PAYER_ADDRESS?.trim()||undefined;
  const agentMasterKey=managedMasterKey(process.env.CARDANO_MANAGED_AGENT_MASTER_KEY);
  const cfg={appEnv,network,signingMode,payerAddress,agentMasterKey,blockfrostUrl:required("CARDANO_BLOCKFROST_URL").replace(/\/$/,""),blockfrostProjectId:required("CARDANO_BLOCKFROST_PROJECT_ID"),apiKey:required("CARDANO_SIGNER_API_KEY"),port:numberEnv("PORT",8791,1,65535),minOutput:bigintEnv("CARDANO_MIN_OUTPUT_LOVELACE","1000000",500000n,10000000n),minTokenOutput:bigintEnv("CARDANO_TOKEN_OUTPUT_LOVELACE","2000000",1000000n,10000000n),minChange:bigintEnv("CARDANO_MIN_CHANGE_LOVELACE","2000000",1000000n,10000000n),maxInputs:numberEnv("CARDANO_MAX_INPUTS",20,1,64),usdcxAssetId,remoteSignerUrl:process.env.CARDANO_ED25519_SIGNER_URL,remoteSignerApiKey:process.env.CARDANO_ED25519_SIGNER_API_KEY,publicKeyHex:process.env.CARDANO_PAYMENT_PUBLIC_KEY_HEX,seedHex:process.env.CARDANO_SIGNING_SEED_HEX};
  if(cfg.apiKey.length<32)throw new Error("CARDANO_SIGNER_API_KEY_TOO_SHORT");
  if(cfg.network==="cardano:mainnet"&&cfg.agentMasterKey)throw new Error("CARDANO_MANAGED_AGENT_MASTER_KEY_TESTNET_ONLY");
  if(cfg.appEnv==="production"){
    if(new URL(cfg.blockfrostUrl).protocol!=="https:")throw new Error("CARDANO_BLOCKFROST_URL_HTTPS_REQUIRED");
    if(cfg.seedHex)throw new Error("CARDANO_RAW_SIGNING_SEED_PROHIBITED_IN_PRODUCTION");
    if(cfg.network==="cardano:preprod"&&!cfg.agentMasterKey)throw new Error("CARDANO_MANAGED_AGENT_MASTER_KEY_REQUIRED");
    if(cfg.signingMode==="managed"){
      if(!cfg.payerAddress||!cfg.remoteSignerUrl||!cfg.remoteSignerApiKey||!cfg.publicKeyHex)throw new Error("CARDANO_REMOTE_ED25519_SIGNER_REQUIRED");
      if(new URL(cfg.remoteSignerUrl).protocol!=="https:")throw new Error("CARDANO_ED25519_SIGNER_URL_HTTPS_REQUIRED");
      if(cfg.remoteSignerApiKey.length<32)throw new Error("CARDANO_ED25519_SIGNER_API_KEY_TOO_SHORT");
      if(safeEqual(cfg.apiKey,cfg.remoteSignerApiKey))throw new Error("CARDANO_SIGNER_CAPABILITY_KEYS_MUST_BE_DISTINCT");
    }
  } else if(cfg.signingMode==="managed"&&!cfg.seedHex&&!cfg.remoteSignerUrl){throw new Error("CARDANO_LOCAL_OR_REMOTE_SIGNER_REQUIRED");}
  if(cfg.seedHex&&!/^[0-9a-fA-F]{64}$/.test(cfg.seedHex))throw new Error("CARDANO_SIGNING_SEED_INVALID");
  if(cfg.publicKeyHex&&!/^[0-9a-fA-F]{64}$/.test(cfg.publicKeyHex))throw new Error("CARDANO_PAYMENT_PUBLIC_KEY_INVALID");
  const startupKey=cfg.publicKeyHex?Buffer.from(cfg.publicKeyHex,"hex"):(cfg.seedHex?publicKeyFromSeed(cfg.seedHex):null);
  if(startupKey&&(!cfg.payerAddress||!blake2b(startupKey,28).equals(paymentCredential(cfg.payerAddress,cfg.network))))throw new Error("CARDANO_PAYER_KEY_MISMATCH");
  return cfg;
}

function bech32Polymod(values){const g=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let chk=1;for(const value of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=g[i];}return chk>>>0;}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>5).concat(0,[...hrp].map(c=>c.charCodeAt(0)&31));}
function toWords(bytes){let acc=0,bits=0;const out=[];for(const byte of bytes){acc=(acc<<8)|byte;bits+=8;while(bits>=5){bits-=5;out.push((acc>>bits)&31);}}if(bits>0)out.push((acc<<(5-bits))&31);return out;}
function bech32Encode(hrp,bytes){const words=toWords(bytes),values=[...hrpExpand(hrp),...words,0,0,0,0,0,0],mod=bech32Polymod(values)^1;const checksum=Array.from({length:6},(_,i)=>(mod>>(5*(5-i)))&31);return `${hrp}1${[...words,...checksum].map(v=>BECH32_ALPHABET[v]).join("")}`;}
function managedAgentSeed(cfg,agentId){if(cfg.network!=="cardano:preprod")throw new Error("CARDANO_MANAGED_AGENT_SIGNING_TESTNET_ONLY");if(!cfg.agentMasterKey)throw new Error("CARDANO_MANAGED_AGENT_MASTER_KEY_REQUIRED");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agentId))throw new Error("CARDANO_MANAGED_AGENT_ID_INVALID");return createHmac("sha256",cfg.agentMasterKey).update(`agentpay-managed-v1|${cfg.network}|${agentId}`).digest("hex");}
function managedAgentIdentity(cfg,agentId){const seed=managedAgentSeed(cfg,agentId),publicKey=publicKeyFromSeed(seed),credential=blake2b(publicKey,28),networkId=cfg.network==="cardano:mainnet"?1:0,header=Buffer.from([(6<<4)|networkId]),address=bech32Encode(networkId===1?"addr":"addr_test",Buffer.concat([header,credential]));return{seed,publicKey,address,signerRef:`agent:${agentId}`};}

async function readJson(req){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>MAX_BODY_BYTES)throw new Error("REQUEST_BODY_TOO_LARGE");chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
async function bfJson(cfg,path){const response=await fetch(`${cfg.blockfrostUrl}${path}`,{headers:{project_id:cfg.blockfrostProjectId,accept:"application/json"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error(`CARDANO_PROVIDER_${response.status}`);return response.json();}
async function addressUtxos(cfg,address){const rows=[];for(let page=1;page<=10;page++){const batch=await bfJson(cfg,`/addresses/${encodeURIComponent(address)}/utxos?count=100&page=${page}&order=asc`);if(!Array.isArray(batch))throw new Error("CARDANO_UTXO_RESPONSE_INVALID");rows.push(...batch);if(batch.length<100)return rows;}throw new Error("CARDANO_UTXO_SET_TOO_LARGE");}
function protocolParams(value){if(!value||typeof value!=="object")throw new Error("CARDANO_PROTOCOL_PARAMETERS_INVALID");const a=String(value.min_fee_a??""),b=String(value.min_fee_b??"");if(!/^\d+$/.test(a)||!/^\d+$/.test(b))throw new Error("CARDANO_PROTOCOL_PARAMETERS_INVALID");return{min_fee_a:a,min_fee_b:b};}
async function publicKey(cfg){if(cfg.publicKeyHex)return Buffer.from(cfg.publicKeyHex,"hex");if(cfg.seedHex)return publicKeyFromSeed(cfg.seedHex);throw new Error("CARDANO_PAYMENT_PUBLIC_KEY_REQUIRED");}
async function signBodyHash(cfg,hash){if(cfg.seedHex)return signHashWithSeed(cfg.seedHex,hash);const response=await fetch(cfg.remoteSignerUrl,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${cfg.remoteSignerApiKey}`},body:JSON.stringify({algorithm:"Ed25519",messageHex:Buffer.from(hash).toString("hex"),purpose:"cardano-transaction-body"}),redirect:"error",signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`CARDANO_REMOTE_SIGNER_${response.status}`);const payload=await response.json();const signatureHex=typeof payload?.signatureHex==="string"?payload.signatureHex:"";if(!/^[0-9a-fA-F]{128}$/.test(signatureHex))throw new Error("CARDANO_REMOTE_SIGNATURE_INVALID");const signature=Buffer.from(signatureHex,"hex"),key=await publicKey(cfg);if(!verifyEd25519(key,hash,signature))throw new Error("CARDANO_REMOTE_SIGNATURE_INVALID");return signature;}

function validateRequirement(body,cfg,payerAddress){if(!body||typeof body!=="object")throw new Error("CARDANO_SIGN_REQUEST_INVALID");const requirement=body.paymentRequirements;if(!requirement||typeof requirement!=="object")throw new Error("CARDANO_PAYMENT_REQUIREMENT_INVALID");if((body.network&&body.network!==cfg.network)||requirement.network!==cfg.network)throw new Error("CARDANO_NETWORK_MISMATCH");decodeAddress(payerAddress,cfg.network);if(body.submissionMode&&body.submissionMode!=="server")throw new Error("CARDANO_SUBMISSION_MODE_MISMATCH");if(requirement.scheme!=="exact"||!/^\d+$/.test(String(requirement.amount??""))||BigInt(requirement.amount)<=0n||!requirement.payTo)throw new Error("CARDANO_PAYMENT_REQUIREMENT_INVALID");if(requirement.asset!=="lovelace"&&requirement.asset!==cfg.usdcxAssetId)throw new Error("CARDANO_ASSET_NOT_WHITELISTED");const timeout=Number(requirement.maxTimeoutSeconds);if(!Number.isInteger(timeout)||timeout<2||timeout>3600)throw new Error("CARDANO_TIMEOUT_INVALID");return{requirement,timeout,payerAddress};}
function validateRequest(body,cfg){if(body.payerAddress!==cfg.payerAddress)throw new Error("CARDANO_PAYER_MISMATCH");return validateRequirement(body,cfg,cfg.payerAddress);}
function validateUnsignedRequest(body,cfg){return validateRequirement(body,cfg,String(body.payerAddress??""));}

async function buildManagedAgentTransaction(cfg,body){const agentId=String(body.agentId??""),payerAddress=String(body.payerAddress??body.payerAccountId??""),identity=managedAgentIdentity(cfg,agentId);if(identity.address!==payerAddress)throw new Error("CARDANO_MANAGED_AGENT_IDENTITY_MISMATCH");const {requirement,timeout}=validateRequirement(body,cfg,payerAddress);const [latest,params,utxos]=await Promise.all([bfJson(cfg,"/blocks/latest"),bfJson(cfg,"/epochs/latest/parameters"),addressUtxos(cfg,payerAddress)]);if(!Number.isInteger(latest?.slot)||latest.slot<0)throw new Error("CARDANO_LATEST_SLOT_UNAVAILABLE");const common={network:cfg.network,payerAddress,payeeAddress:requirement.payTo,assetUnit:requirement.asset,amountAtomic:String(requirement.amount),maxTimeoutSeconds:timeout,latestSlot:latest.slot,protocolParameters:protocolParams(params),utxos,minOutputLovelace:cfg.minOutput,minTokenOutputLovelace:cfg.minTokenOutput,minChangeLovelace:cfg.minChange,maxInputs:cfg.maxInputs};return buildSignedCardanoTransaction({...common,publicKey:identity.publicKey,signBodyHash:(hash)=>signHashWithSeed(identity.seed,hash)});}

export function createSignerServer(cfg=configFromEnv()){
  return createServer(async(req,res)=>{
    try{
      if(req.method==="GET"&&req.url==="/health")return json(res,200,{status:"ok",network:cfg.network,custody:cfg.signingMode==="unsigned-only"?"self-custody-unsigned-only":cfg.appEnv==="production"?"remote-ed25519":"isolated-test-signer",managedIdentity:cfg.network==="cardano:preprod"&&cfg.agentMasterKey?"isolated-per-agent":"disabled",assets:["lovelace",...(cfg.usdcxAssetId?[cfg.usdcxAssetId]:[])]});
      const allowed=["/sign","/unsigned","/managed-identity","/managed-agent-sign","/"];
      if(req.method!=="POST"||!allowed.includes(req.url))return json(res,404,{code:"NOT_FOUND"});
      const auth=req.headers.authorization;if(!auth?.startsWith("Bearer ")||!safeEqual(auth.slice(7),cfg.apiKey))return json(res,401,{code:"UNAUTHORIZED"});
      const body=await readJson(req);
      if(req.url==="/managed-identity"){
        const agentId=String(body.agentId??"");if(body.network!==cfg.network)throw new Error("CARDANO_NETWORK_MISMATCH");const identity=managedAgentIdentity(cfg,agentId);return json(res,200,{accountId:identity.address,payerAddress:identity.address,publicKey:identity.publicKey.toString("hex"),signerRef:identity.signerRef});
      }
      if(req.url==="/managed-agent-sign"){
        const signed=await buildManagedAgentTransaction(cfg,body);return json(res,200,{transaction:signed.transaction,nonce:signed.nonce,transactionId:signed.transactionId,asset:signed.assetUnit,amount:signed.amountAtomic});
      }
      if(cfg.appEnv==="production"&&req.url!=="/unsigned")return json(res,410,{code:"CARDANO_SHARED_MANAGED_SIGNING_DISABLED"});
      if(cfg.signingMode==="unsigned-only"&&req.url!=="/unsigned")return json(res,403,{code:"CARDANO_MANAGED_SIGNING_DISABLED"});
      const unsigned=req.url==="/unsigned",validated=unsigned?validateUnsignedRequest(body,cfg):validateRequest(body,cfg),{requirement,timeout}=validated,payerAddress=validated.payerAddress;
      const [latest,params,utxos,key]=await Promise.all([bfJson(cfg,"/blocks/latest"),bfJson(cfg,"/epochs/latest/parameters"),addressUtxos(cfg,payerAddress),unsigned?Promise.resolve(null):publicKey(cfg)]);
      if(!Number.isInteger(latest?.slot)||latest.slot<0)throw new Error("CARDANO_LATEST_SLOT_UNAVAILABLE");
      const common={network:cfg.network,payerAddress,payeeAddress:requirement.payTo,assetUnit:requirement.asset,amountAtomic:String(requirement.amount),maxTimeoutSeconds:timeout,latestSlot:latest.slot,protocolParameters:protocolParams(params),utxos,minOutputLovelace:cfg.minOutput,minTokenOutputLovelace:cfg.minTokenOutput,minChangeLovelace:cfg.minChange,maxInputs:cfg.maxInputs};
      const signed=unsigned?buildUnsignedCardanoTransaction(common):await buildSignedCardanoTransaction({...common,publicKey:key,signBodyHash:(hash)=>signBodyHash(cfg,hash)});
      return json(res,200,{transaction:signed.transaction,nonce:signed.nonce,transactionId:signed.transactionId,asset:signed.assetUnit,amount:signed.amountAtomic});
    }catch(error){const code=error instanceof Error&&(error.message.startsWith("CARDANO_")||error.message==="REQUEST_BODY_TOO_LARGE")?error.message:"CARDANO_SIGNING_FAILED";const status=code==="REQUEST_BODY_TOO_LARGE"?413:code.includes("PROVIDER_")||code.includes("REMOTE_SIGNER_")?502:422;console.error(JSON.stringify({event:"cardano_signing_request_failed",code}));return json(res,status,{code});}
  });
}

if(import.meta.url===`file://${process.argv[1]}`){const cfg=configFromEnv();createSignerServer(cfg).listen(cfg.port,"0.0.0.0",()=>console.log(JSON.stringify({event:"cardano_signer_listening",port:cfg.port,network:cfg.network})));}

export { configFromEnv };
