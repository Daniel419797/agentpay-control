import assert from "node:assert/strict";
import test from "node:test";
import { blake2b, buildSignedAdaTransaction, buildSignedCardanoTransaction, buildUnsignedCardanoTransaction, publicKeyFromSeed, selectAdaOnlyUtxos, selectWhitelistedTokenUtxos, signHashWithSeed } from "./cardano.mjs";

const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const USDCX = `${"ab".repeat(28)}5553444378`;
function polymod(values){const g=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let chk=1;for(const value of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=g[i];}return chk>>>0;}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>5).concat(0,[...hrp].map(c=>c.charCodeAt(0)&31));}
function convert8to5(bytes){let acc=0,bits=0;const out=[];for(const byte of bytes){acc=(acc<<8)|byte;bits+=8;while(bits>=5){bits-=5;out.push((acc>>bits)&31);}}if(bits>0)out.push((acc<<(5-bits))&31);return out;}
function bech32(hrp,bytes){const data=convert8to5(bytes),values=[...hrpExpand(hrp),...data,...Array(6).fill(0)],mod=polymod(values)^1,checksum=Array.from({length:6},(_,i)=>(mod>>(5*(5-i)))&31);return `${hrp}1${[...data,...checksum].map(v=>ALPHABET[v]).join("")}`;}
function enterpriseAddress(publicKey,networkId=0){const credential=blake2b(publicKey,28);return bech32(networkId===1?"addr":"addr_test",Buffer.concat([Buffer.from([(6<<4)|networkId]),credential]));}

test("BLAKE2b uses Cardano digest lengths rather than truncating BLAKE2b-512",()=>{
  assert.equal(blake2b(Buffer.alloc(0),32).toString("hex"),"0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8");
  assert.equal(blake2b(Buffer.from("abc"),28).toString("hex"),"9bd237b02a29e43bdd6738afa5b53ff0eee178d6210b618e4511aec8");
});

test("derives the RFC 8032 Ed25519 public key from a 32-byte seed",()=>{
  const seed="9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
  assert.equal(publicKeyFromSeed(seed).toString("hex"),"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
});

test("ADA UTxO selection excludes every token-bearing UTxO",()=>{
  const rows=[
    {tx_hash:"a".repeat(64),output_index:0,amount:[{unit:"lovelace",quantity:"9000000"},{unit:USDCX,quantity:"1"}]},
    {tx_hash:"b".repeat(64),output_index:1,amount:[{unit:"lovelace",quantity:"3000000"}]},
  ];
  const selected=selectAdaOnlyUtxos(rows,2_000_000n);
  assert.equal(selected.selected.length,1);
  assert.equal(selected.selected[0].tx_hash,"b".repeat(64));
});

test("token selection accepts only lovelace plus the explicitly requested asset",()=>{
  const other=`${"cd".repeat(28)}01`;
  const rows=[
    {tx_hash:"a".repeat(64),output_index:0,amount:[{unit:"lovelace",quantity:"9000000"},{unit:USDCX,quantity:"5000000"},{unit:other,quantity:"1"}]},
    {tx_hash:"b".repeat(64),output_index:1,amount:[{unit:"lovelace",quantity:"5000000"},{unit:USDCX,quantity:"3000000"}]},
    {tx_hash:"c".repeat(64),output_index:2,amount:[{unit:"lovelace",quantity:"5000000"}]},
  ];
  const selected=selectWhitelistedTokenUtxos(rows,{assetUnit:USDCX,requiredToken:2_000_000n,requiredLovelace:4_000_000n});
  assert.equal(selected.selected.length,1);
  assert.equal(selected.selected[0].tx_hash,"b".repeat(64));
  assert.equal(selected.totalToken,3_000_000n);
});

test("builds and signs a deterministic ADA-only Preprod transaction",async()=>{
  const seed="9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",publicKey=publicKeyFromSeed(seed),payer=enterpriseAddress(publicKey),payee=enterpriseAddress(Buffer.alloc(32,7));
  const result=await buildSignedAdaTransaction({
    network:"cardano:preprod",payerAddress:payer,payeeAddress:payee,amountLovelace:"1000000",maxTimeoutSeconds:900,latestSlot:1000000,
    protocolParameters:{min_fee_a:"44",min_fee_b:"155381"},
    utxos:[{tx_hash:"c".repeat(64),output_index:2,amount:[{unit:"lovelace",quantity:"5000000"}]}],
    publicKey,signBodyHash:(hash)=>signHashWithSeed(seed,hash),minOutputLovelace:1_000_000n,minChangeLovelace:1_000_000n,
  });
  assert.match(result.transactionId,/^[0-9a-f]{64}$/);
  assert.equal(result.nonce,`${"c".repeat(64)}#2`);
  assert.ok(Buffer.from(result.transaction,"base64").length>100);
  assert.equal(result.inputCount,1);
});

test("builds CIP-30 unsigned CBOR with the same exact body and fee as the signed transaction",async()=>{
  const seed="9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",publicKey=publicKeyFromSeed(seed),payer=enterpriseAddress(publicKey),payee=enterpriseAddress(Buffer.alloc(32,7));
  const common={network:"cardano:preprod",payerAddress:payer,payeeAddress:payee,assetUnit:"lovelace",amountAtomic:"1000000",maxTimeoutSeconds:900,latestSlot:1000000,protocolParameters:{min_fee_a:"44",min_fee_b:"155381"},utxos:[{tx_hash:"c".repeat(64),output_index:2,amount:[{unit:"lovelace",quantity:"5000000"}]}],minOutputLovelace:1_000_000n,minChangeLovelace:1_000_000n};
  const unsigned=buildUnsignedCardanoTransaction(common);
  const signed=await buildSignedCardanoTransaction({...common,publicKey,signBodyHash:(hash)=>signHashWithSeed(seed,hash)});
  assert.equal(unsigned.transactionId,signed.transactionId);
  assert.equal(unsigned.feeLovelace,signed.feeLovelace);
  assert.match(unsigned.transaction,/^[0-9a-f]+$/);
  assert.ok(Buffer.from(unsigned.transaction,"hex").length>80);
});

test("builds an exact whitelisted native-token payment with token change only to payer",async()=>{
  const seed="9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",publicKey=publicKeyFromSeed(seed),payer=enterpriseAddress(publicKey),payee=enterpriseAddress(Buffer.alloc(32,8));
  const result=await buildSignedCardanoTransaction({
    network:"cardano:preprod",payerAddress:payer,payeeAddress:payee,assetUnit:USDCX,amountAtomic:"2000000",maxTimeoutSeconds:900,latestSlot:1000000,
    protocolParameters:{min_fee_a:"44",min_fee_b:"155381"},
    utxos:[{tx_hash:"d".repeat(64),output_index:3,amount:[{unit:"lovelace",quantity:"8000000"},{unit:USDCX,quantity:"5000000"}]}],
    publicKey,signBodyHash:(hash)=>signHashWithSeed(seed,hash),minTokenOutputLovelace:2_000_000n,minChangeLovelace:1_000_000n,
  });
  assert.match(result.transactionId,/^[0-9a-f]{64}$/);
  assert.equal(result.assetUnit,USDCX);
  assert.equal(result.amountAtomic,"2000000");
  assert.ok(Buffer.from(result.transaction,"base64").length>130);
});

test("token payments fail rather than consume unrelated native assets",async()=>{
  const seed="9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",publicKey=publicKeyFromSeed(seed),payer=enterpriseAddress(publicKey),payee=enterpriseAddress(Buffer.alloc(32,9)),other=`${"ef".repeat(28)}01`;
  await assert.rejects(buildSignedCardanoTransaction({
    network:"cardano:preprod",payerAddress:payer,payeeAddress:payee,assetUnit:USDCX,amountAtomic:"1000000",maxTimeoutSeconds:900,latestSlot:1000000,
    protocolParameters:{min_fee_a:"44",min_fee_b:"155381"},
    utxos:[{tx_hash:"e".repeat(64),output_index:0,amount:[{unit:"lovelace",quantity:"9000000"},{unit:USDCX,quantity:"5000000"},{unit:other,quantity:"1"}]}],
    publicKey,signBodyHash:(hash)=>signHashWithSeed(seed,hash),
  }),/CARDANO_INSUFFICIENT_WHITELISTED_TOKEN/);
});
