import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";

const MASK64 = 0xffffffffffffffffn;
const IV = [0x6a09e667f3bcc908n,0xbb67ae8584caa73bn,0x3c6ef372fe94f82bn,0xa54ff53a5f1d36f1n,0x510e527fade682d1n,0x9b05688c2b3e6c1fn,0x1f83d9abfb41bd6bn,0x5be0cd19137e2179n];
const SIGMA = [[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],[14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],[11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],[7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],[9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],[2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],[12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],[13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],[6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],[10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],[14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3]];
const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function add64(...values) { return values.reduce((a,b)=>(a+b)&MASK64,0n); }
function rotr(v,n) { return ((v>>n)|(v<<(64n-n)))&MASK64; }
function compress(h, block, count, last) {
  const m = Array.from({length:16},(_,i)=>block.readBigUInt64LE(i*8));
  const v = [...h,...IV]; v[12]^=count&MASK64; v[13]^=(count>>64n)&MASK64; if(last)v[14]=(~v[14])&MASK64;
  const g=(a,b,c,d,x,y)=>{v[a]=add64(v[a],v[b],x);v[d]=rotr(v[d]^v[a],32n);v[c]=add64(v[c],v[d]);v[b]=rotr(v[b]^v[c],24n);v[a]=add64(v[a],v[b],y);v[d]=rotr(v[d]^v[a],16n);v[c]=add64(v[c],v[d]);v[b]=rotr(v[b]^v[c],63n);};
  for(let r=0;r<12;r++){const s=SIGMA[r];g(0,4,8,12,m[s[0]],m[s[1]]);g(1,5,9,13,m[s[2]],m[s[3]]);g(2,6,10,14,m[s[4]],m[s[5]]);g(3,7,11,15,m[s[6]],m[s[7]]);g(0,5,10,15,m[s[8]],m[s[9]]);g(1,6,11,12,m[s[10]],m[s[11]]);g(2,7,8,13,m[s[12]],m[s[13]]);g(3,4,9,14,m[s[14]],m[s[15]]);}
  for(let i=0;i<8;i++)h[i]=(h[i]^v[i]^v[i+8])&MASK64;
}
export function blake2b(input, outLen) {
  if(!Number.isInteger(outLen)||outLen<1||outLen>64)throw new Error("BLAKE2B_OUTPUT_LENGTH_INVALID");
  const data=Buffer.from(input),h=[...IV]; h[0]^=BigInt(0x01010000^outLen); let offset=0,count=0n;
  while(offset+128<data.length){count+=128n;compress(h,data.subarray(offset,offset+128),count,false);offset+=128;}
  const final=Buffer.alloc(128),len=data.length-offset;if(len)data.copy(final,0,offset);count+=BigInt(len);compress(h,final,count,true);
  const out=Buffer.alloc(64);for(let i=0;i<8;i++)out.writeBigUInt64LE(h[i],i*8);return out.subarray(0,outLen);
}

function polymod(values){const g=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let chk=1;for(const value of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=g[i];}return chk>>>0;}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>5).concat(0,[...hrp].map(c=>c.charCodeAt(0)&31));}
function convertBits(values,from,to){let acc=0,bits=0;const out=[],max=(1<<to)-1;for(const v of values){if(v<0||(v>>from)!==0)throw new Error("BECH32_DATA_INVALID");acc=(acc<<from)|v;bits+=from;while(bits>=to){bits-=to;out.push((acc>>bits)&max);}}if(bits>=from||((acc<<(to-bits))&max)!==0)throw new Error("BECH32_PADDING_INVALID");return Buffer.from(out);}
export function decodeAddress(address, network){if(address!==address.toLowerCase())throw new Error("CARDANO_ADDRESS_CASE_INVALID");const sep=address.lastIndexOf("1");if(sep<1||sep+7>address.length)throw new Error("CARDANO_ADDRESS_INVALID");const hrp=address.slice(0,sep),vals=[...address.slice(sep+1)].map(c=>BECH32_ALPHABET.indexOf(c));if(vals.some(v=>v<0)||polymod([...hrpExpand(hrp),...vals])!==1)throw new Error("CARDANO_ADDRESS_CHECKSUM_INVALID");const bytes=convertBits(vals.slice(0,-6),5,8),networkId=bytes[0]&15,type=bytes[0]>>4,mainnet=network==="cardano:mainnet";if(hrp!==(mainnet?"addr":"addr_test")||networkId!==(mainnet?1:0))throw new Error("CARDANO_ADDRESS_NETWORK_MISMATCH");if(bytes.length<29)throw new Error("CARDANO_ADDRESS_LENGTH_INVALID");return{bytes,networkId,type};}
export function paymentCredential(address, network){const d=decodeAddress(address,network);if(![0,2,4,6].includes(d.type))throw new Error("CARDANO_PAYER_KEY_CREDENTIAL_REQUIRED");return d.bytes.subarray(1,29);}

function head(major,value){const n=BigInt(value);if(n<24n)return Buffer.from([(major<<5)|Number(n)]);if(n<=0xffn)return Buffer.from([(major<<5)|24,Number(n)]);if(n<=0xffffn){const b=Buffer.alloc(3);b[0]=(major<<5)|25;b.writeUInt16BE(Number(n),1);return b;}if(n<=0xffffffffn){const b=Buffer.alloc(5);b[0]=(major<<5)|26;b.writeUInt32BE(Number(n),1);return b;}if(n<=0xffffffffffffffffn){const b=Buffer.alloc(9);b[0]=(major<<5)|27;b.writeBigUInt64BE(n,1);return b;}throw new Error("CBOR_INTEGER_TOO_LARGE");}
export const cbor={uint:(n)=>head(0,n),bytes:(b)=>Buffer.concat([head(2,b.length),Buffer.from(b)]),array:(items)=>Buffer.concat([head(4,items.length),...items]),map:(entries)=>Buffer.concat([head(5,entries.length),...entries.flatMap(([k,v])=>[k,v])]),bool:(v)=>Buffer.from([v?0xf5:0xf4]),null:()=>Buffer.from([0xf6])};

function inputCbor(utxo){return cbor.array([cbor.bytes(Buffer.from(utxo.tx_hash,"hex")),cbor.uint(utxo.output_index)]);}
function outputCbor(addressBytes,lovelace){return cbor.array([cbor.bytes(addressBytes),cbor.uint(lovelace)]);}
function bodyCbor(inputs,payeeBytes,payerBytes,payment,change,fee,ttl,networkId){const outputs=[outputCbor(payeeBytes,payment)];if(change>0n)outputs.push(outputCbor(payerBytes,change));return cbor.map([[cbor.uint(0),cbor.array(inputs.map(inputCbor))],[cbor.uint(1),cbor.array(outputs)],[cbor.uint(2),cbor.uint(fee)],[cbor.uint(3),cbor.uint(ttl)],[cbor.uint(15),cbor.uint(networkId)]]);}
function witnessSet(vkey,signature){return cbor.map([[cbor.uint(0),cbor.array([cbor.array([cbor.bytes(vkey),cbor.bytes(signature)])])]]);}
function signedTransaction(body,vkey,signature){return cbor.array([body,witnessSet(vkey,signature),cbor.bool(true),cbor.null()]);}

export function publicKeyFromSeed(seedHex){if(!/^[0-9a-fA-F]{64}$/.test(seedHex))throw new Error("CARDANO_SIGNING_SEED_INVALID");const privateKey=createPrivateKey({key:Buffer.concat([ED25519_PKCS8_PREFIX,Buffer.from(seedHex,"hex")]),format:"der",type:"pkcs8"});const publicDer=createPublicKey(privateKey).export({format:"der",type:"spki"});return Buffer.from(publicDer).subarray(-32);}
export function signHashWithSeed(seedHex, hash){const privateKey=createPrivateKey({key:Buffer.concat([ED25519_PKCS8_PREFIX,Buffer.from(seedHex,"hex")]),format:"der",type:"pkcs8"});return nodeSign(null,Buffer.from(hash),privateKey);}
export function verifyEd25519(publicKey, message, signature){const key=createPublicKey({key:Buffer.concat([ED25519_SPKI_PREFIX,Buffer.from(publicKey)]),format:"der",type:"spki"});return nodeVerify(null,Buffer.from(message),key,Buffer.from(signature));}

function parseAmount(rows){if(!Array.isArray(rows)||rows.length!==1||rows[0]?.unit!=="lovelace"||!/^\d+$/.test(String(rows[0]?.quantity??"")))return null;return BigInt(rows[0].quantity);}
export function selectAdaOnlyUtxos(rows, required, maxInputs=20){const candidates=rows.map(row=>({...row,lovelace:parseAmount(row.amount)})).filter(row=>row.lovelace!==null).sort((a,b)=>a.lovelace===b.lovelace?(a.tx_hash.localeCompare(b.tx_hash)||a.output_index-b.output_index):(a.lovelace<b.lovelace?-1:1));const selected=[];let total=0n;for(const row of candidates){selected.push(row);total+=row.lovelace;if(total>=required)break;if(selected.length>=maxInputs)break;}if(total<required)throw new Error("CARDANO_INSUFFICIENT_ADA_ONLY_UTXOS");return{selected,total};}

export async function buildSignedAdaTransaction({network,payerAddress,payeeAddress,amountLovelace,maxTimeoutSeconds,latestSlot,protocolParameters,utxos,publicKey,signBodyHash,minOutputLovelace=1_000_000n,minChangeLovelace=2_000_000n,maxInputs=20}){
  if(!["cardano:preprod","cardano:mainnet"].includes(network))throw new Error("CARDANO_NETWORK_UNSUPPORTED");const payer=decodeAddress(payerAddress,network),payee=decodeAddress(payeeAddress,network);const amount=BigInt(amountLovelace);if(amount<minOutputLovelace)throw new Error("CARDANO_PAYMENT_BELOW_MIN_OUTPUT");if(!Number.isInteger(maxTimeoutSeconds)||maxTimeoutSeconds<2||maxTimeoutSeconds>3600)throw new Error("CARDANO_TIMEOUT_INVALID");const a=BigInt(protocolParameters.min_fee_a),b=BigInt(protocolParameters.min_fee_b);if(a<=0n||b<=0n)throw new Error("CARDANO_PROTOCOL_PARAMETERS_INVALID");const ttl=BigInt(latestSlot)+BigInt(Math.min(maxTimeoutSeconds-1,600));const feeReserve=b+a*1200n;const {selected,total}=selectAdaOnlyUtxos(utxos,amount+feeReserve+minChangeLovelace,maxInputs);let fee=feeReserve;
  const vkey=Buffer.from(publicKey);if(vkey.length!==32)throw new Error("CARDANO_PAYMENT_PUBLIC_KEY_INVALID");if(!blake2b(vkey,28).equals(paymentCredential(payerAddress,network)))throw new Error("CARDANO_PAYER_KEY_MISMATCH");let body,tx,change;
  for(let i=0;i<8;i++){change=total-amount-fee;if(change!==0n&&change<minChangeLovelace)throw new Error("CARDANO_CHANGE_BELOW_SAFE_MINIMUM");body=bodyCbor(selected,payee.bytes,payer.bytes,amount,change,fee,ttl,payer.networkId);const dummy=Buffer.alloc(64);tx=signedTransaction(body,vkey,dummy);const nextFee=a*BigInt(tx.length)+b;if(nextFee===fee)break;fee=nextFee;if(i===7)throw new Error("CARDANO_FEE_DID_NOT_CONVERGE");}
  change=total-amount-fee;if(change<0n)throw new Error("CARDANO_INSUFFICIENT_ADA_ONLY_UTXOS");body=bodyCbor(selected,payee.bytes,payer.bytes,amount,change,fee,ttl,payer.networkId);const bodyHash=blake2b(body,32);const signature=Buffer.from(await signBodyHash(bodyHash));if(signature.length!==64||!verifyEd25519(vkey,bodyHash,signature))throw new Error("CARDANO_REMOTE_SIGNATURE_INVALID");tx=signedTransaction(body,vkey,signature);const expectedFee=a*BigInt(tx.length)+b;if(expectedFee!==fee)throw new Error("CARDANO_FINAL_FEE_MISMATCH");return{transaction:tx.toString("base64"),transactionId:bodyHash.toString("hex"),nonce:`${selected[0].tx_hash}#${selected[0].output_index}`,feeLovelace:fee.toString(),ttl:ttl.toString(),inputCount:selected.length};}
