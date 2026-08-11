import assert from "node:assert/strict";
import test from "node:test";
import { blake2b, publicKeyFromSeed } from "./cardano.mjs";
import { configFromEnv } from "./server.mjs";

const ALPHABET="qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values){const g=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let chk=1;for(const value of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=g[i];}return chk>>>0;}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>5).concat(0,[...hrp].map(c=>c.charCodeAt(0)&31));}
function convert(bytes){let acc=0,bits=0;const out=[];for(const byte of bytes){acc=(acc<<8)|byte;bits+=8;while(bits>=5){bits-=5;out.push((acc>>bits)&31);}}if(bits)out.push((acc<<(5-bits))&31);return out;}
function address(publicKey){const bytes=Buffer.concat([Buffer.from([0x60]),blake2b(publicKey,28)]),data=convert(bytes),values=[...hrpExpand("addr_test"),...data,...Array(6).fill(0)],mod=polymod(values)^1,checksum=Array.from({length:6},(_,i)=>(mod>>(5*(5-i)))&31);return `addr_test1${[...data,...checksum].map(v=>ALPHABET[v]).join("")}`;}

function withEnv(values,fn){const before={...process.env};Object.assign(process.env,values);for(const key of Object.keys(process.env))if(!(key in before)&&!(key in values))delete process.env[key];try{return fn();}finally{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,before);}}

const seed="9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",publicKey=publicKeyFromSeed(seed),payer=address(publicKey);
const base={APP_ENV:"production",CARDANO_NETWORK:"preprod",CARDANO_PAYER_ADDRESS:payer,CARDANO_BLOCKFROST_URL:"https://cardano-preprod.blockfrost.io/api/v0",CARDANO_BLOCKFROST_PROJECT_ID:"preprod-project-id-abcdefghijklmnopqrstuvwxyz",CARDANO_SIGNER_API_KEY:"gateway-secret-abcdefghijklmnopqrstuvwxyz",CARDANO_PAYMENT_PUBLIC_KEY_HEX:publicKey.toString("hex"),CARDANO_ED25519_SIGNER_URL:"https://kms.example/sign",CARDANO_ED25519_SIGNER_API_KEY:"custody-secret-abcdefghijklmnopqrstuvwxyz"};

test("production requires the remote Ed25519 custody boundary",()=>withEnv({...base,CARDANO_ED25519_SIGNER_URL:"",CARDANO_ED25519_SIGNER_API_KEY:""},()=>assert.throws(()=>configFromEnv(),/REMOTE_ED25519_SIGNER_REQUIRED/)));
test("production rejects plaintext signing seed material",()=>withEnv({...base,CARDANO_SIGNING_SEED_HEX:seed},()=>assert.throws(()=>configFromEnv(),/RAW_SIGNING_SEED_PROHIBITED/)));
test("production requires distinct gateway and custody capability secrets",()=>withEnv({...base,CARDANO_ED25519_SIGNER_API_KEY:base.CARDANO_SIGNER_API_KEY},()=>assert.throws(()=>configFromEnv(),/MUST_BE_DISTINCT/)));
test("complete production configuration is accepted",()=>withEnv(base,()=>assert.equal(configFromEnv().network,"cardano:preprod")));
