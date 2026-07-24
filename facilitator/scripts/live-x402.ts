import { PrivateKey } from "@hiero-ledger/sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { createClientHederaSigner } from "@x402/hedera";

function required(name:string){const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
function privateKey(value:string){const normalized=value.startsWith("0x")?value.slice(2):value;return normalized.length===64?PrivateKey.fromStringECDSA(normalized):PrivateKey.fromString(value);}

const network=`hedera:${process.env.HEDERA_NETWORK??"testnet"}`;
const payer=required("HEDERA_PAYER_ID");
const signer=createClientHederaSigner(payer,privateKey(required("HEDERA_PAYER_KEY")),{network});
const requirements:PaymentRequirements={scheme:"exact",network:network as PaymentRequirements["network"],asset:"0.0.0",amount:"100000",payTo:required("HEDERA_PROVIDER_ID"),maxTimeoutSeconds:900,extra:{feePayer:required("HEDERA_OPERATOR_ID")}};
const transaction=await signer.createPartiallySignedTransferTransaction(requirements);
const paymentPayload:PaymentPayload={x402Version:2,accepted:requirements,payload:{transaction}};
const body=JSON.stringify({paymentPayload,paymentRequirements:requirements});
const verified=await fetch("http://127.0.0.1:8787/verify",{method:"POST",headers:{"content-type":"application/json"},body});
const verification=await verified.json() as {isValid:boolean;invalidReason?:string;payer?:string};
if(!verified.ok||!verification.isValid)throw new Error(`x402 verify failed: ${verification.invalidReason??verified.status}`);
const settled=await fetch("http://127.0.0.1:8787/settle",{method:"POST",headers:{"content-type":"application/json"},body});
const settlement=await settled.json() as {success:boolean;transaction?:string;transactionId?:string;errorReason?:string;network?:string};
if(!settled.ok||!settlement.success)throw new Error(`x402 settle failed: ${settlement.errorReason??settled.status}`);
console.log(JSON.stringify({verified:verification.isValid,payer:verification.payer,success:settlement.success,network:settlement.network,transaction:settlement.transaction??settlement.transactionId},null,2));
