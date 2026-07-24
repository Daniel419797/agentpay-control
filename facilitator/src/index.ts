import { AccountId, Client, Hbar, PrivateKey, TokenId, TransferTransaction } from "@hiero-ledger/sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  createHederaClient,
  createClientHederaSigner,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  toFacilitatorHederaSigner
} from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";

const env=z.object({HEDERA_NETWORK:z.enum(["testnet","mainnet"]).default("testnet"),HEDERA_OPERATOR_ID:z.string(),HEDERA_OPERATOR_KEY:z.string(),HEDERA_PAYER_ID:z.string(),HEDERA_PAYER_KEY:z.string(),PORT:z.coerce.number().default(8787)}).parse(process.env);
function parsePrivateKey(value:string){const normalized=value.startsWith("0x")?value.slice(2):value;return normalized.length===64?PrivateKey.fromStringECDSA(normalized):PrivateKey.fromString(value);}
const client=env.HEDERA_NETWORK==="mainnet"?Client.forMainnet():Client.forTestnet(); const operatorKey=parsePrivateKey(env.HEDERA_OPERATOR_KEY); client.setOperator(AccountId.fromString(env.HEDERA_OPERATOR_ID),operatorKey); const payerKey=parsePrivateKey(env.HEDERA_PAYER_KEY);
const caipNetwork=`hedera:${env.HEDERA_NETWORK}`;
const managedClientSigner=createClientHederaSigner(env.HEDERA_PAYER_ID,payerKey,{network:caipNetwork});
const x402Signer=toFacilitatorHederaSigner({getAddresses:()=>[env.HEDERA_OPERATOR_ID],signAndSubmitTransaction:createHederaSignAndSubmitTransaction(network=>createHederaClient(network),operatorKey),verifyPayerSignature:createHederaVerifyPayerSignature(),preflightTransfer:createHederaPreflightTransfer()});
const x402Scheme=new ExactHederaScheme(x402Signer);
const requestSchema=z.object({intentId:z.string().uuid(),fingerprint:z.string().length(64),payerAccountId:z.string(),payeeAccountId:z.string(),amountAtomic:z.string().regex(/^\d+$/),asset:z.object({type:z.enum(["NATIVE","TOKEN"]),hederaTokenId:z.string().optional()})});
const x402Request=z.object({paymentPayload:z.custom<PaymentPayload>(),paymentRequirements:z.custom<PaymentRequirements>()});
const app=new Hono();
app.get("/health",c=>c.json({status:"ok",network:env.HEDERA_NETWORK,x402Version:2}));
app.get("/supported",c=>c.json({kinds:[{x402Version:2,scheme:"exact",network:caipNetwork,extra:x402Scheme.getExtra(caipNetwork)}]}));
app.post("/managed-sign",async c=>{try{const {paymentRequirements}=z.object({paymentRequirements:z.custom<PaymentRequirements>()}).parse(await c.req.json());if(paymentRequirements.network!==caipNetwork)return c.json({code:"NETWORK_MISMATCH"},422);const transaction=await managedClientSigner.createPartiallySignedTransferTransaction(paymentRequirements);const paymentPayload:PaymentPayload={x402Version:2,accepted:paymentRequirements,payload:{transaction}};return c.json({paymentPayload});}catch(error){return c.json({code:"SIGNING_FAILED",detail:error instanceof Error?error.message:"Unknown failure"},500);}});
app.post("/verify",async c=>{try{const body=x402Request.parse(await c.req.json());return c.json(await x402Scheme.verify(body.paymentPayload,body.paymentRequirements));}catch(error){return c.json({isValid:false,invalidReason:"invalid_request",invalidMessage:error instanceof Error?error.message:"Invalid request"},400);}});
app.post("/settle",async c=>{try{const body=x402Request.parse(await c.req.json());const verified=await x402Scheme.verify(body.paymentPayload,body.paymentRequirements);if(!verified.isValid)return c.json(verified,422);return c.json(await x402Scheme.settle(body.paymentPayload,body.paymentRequirements));}catch(error){return c.json({success:false,errorReason:"invalid_request",errorMessage:error instanceof Error?error.message:"Invalid request"},400);}});
app.post("/managed-settle",async c=>{try{const body=requestSchema.parse(await c.req.json());if(body.payerAccountId!==env.HEDERA_PAYER_ID)return c.json({code:"PAYER_MISMATCH"},403);const payer=AccountId.fromString(body.payerAccountId);const payee=AccountId.fromString(body.payeeAccountId);let transaction=new TransferTransaction();if(body.asset.type==="NATIVE"){const amount=Hbar.fromTinybars(body.amountAtomic);transaction=transaction.addHbarTransfer(payer,amount.negated()).addHbarTransfer(payee,amount);}else{if(!body.asset.hederaTokenId)return c.json({code:"TOKEN_ID_REQUIRED"},422);const token=TokenId.fromString(body.asset.hederaTokenId);const amount=Number(body.amountAtomic);transaction=transaction.addTokenTransfer(token,payer,-amount).addTokenTransfer(token,payee,amount);}const frozen=await transaction.freezeWith(client);const signed=await frozen.sign(payerKey);const response=await signed.execute(client);const receipt=await response.getReceipt(client);return c.json({transactionId:response.transactionId.toString(),consensusTimestamp:null,resultCode:receipt.status.toString(),fingerprint:body.fingerprint});}catch(error){console.error(error);return c.json({code:"SETTLEMENT_FAILED",detail:error instanceof Error?error.message:"Unknown failure"},500);}});
serve({fetch:app.fetch,port:env.PORT}); console.log(`AgentPay facilitator listening on ${env.PORT}`);
