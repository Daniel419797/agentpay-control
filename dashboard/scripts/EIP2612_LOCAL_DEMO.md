# Local EIP-2612 Permit Demo

This demo exercises the EIP-2612 permit flow with `ethers` v6 on a local development chain only.

## Safety boundaries

The script intentionally:

- runs only when the connected chain ID is `31337` or `1337`;
- requires separate owner and spender **test** private keys;
- derives the spender address from `TEST_SPENDER_PRIVATE_KEY` rather than accepting an arbitrary spender address;
- caps the permit at 10 tokens;
- defaults the transfer to 1 token;
- uses a 15-minute permit deadline;
- refuses to transfer more than the permitted amount;
- checks the owner's token balance and the post-permit allowance before calling `transferFrom()`.

It is not intended for mainnet use or for obtaining authority over third-party wallets.

## Prerequisites

1. Start a local EVM node such as Anvil or a Hardhat node on chain ID `31337` or `1337`.
2. Deploy an ERC-20 token that implements EIP-2612 `permit()` and fund the owner test account with that token.
3. Use local test accounts for both the owner and spender.

The token's EIP-712 version defaults to `1`. Set `TEST_TOKEN_VERSION` if your local test token uses a different version.

## Environment

From the `dashboard` workspace, set:

```bash
export LOCAL_RPC_URL=http://127.0.0.1:8545
export TEST_OWNER_PRIVATE_KEY=0x...
export TEST_SPENDER_PRIVATE_KEY=0x...
export TEST_TOKEN_ADDRESS=0x...
export TEST_RECIPIENT_ADDRESS=0x...
```

Optional values:

```bash
export TEST_TOKEN_VERSION=1
export DEMO_PERMIT_TOKENS=10
export DEMO_TRANSFER_TOKENS=1
```

`DEMO_PERMIT_TOKENS` cannot exceed 10.

## Run

```bash
npm run demo:eip2612-local
```

The script performs this sequence:

1. Connect to the local RPC endpoint.
2. Fetch the network chain ID.
3. Fetch `nonces(owner)` from the token contract.
4. Build the EIP-712 `Permit` typed data.
5. Sign it with the owner test wallet using `signTypedData()`.
6. Decode the signature into `v`, `r`, and `s`.
7. Submit `permit()` from the spender test wallet.
8. Verify the resulting allowance.
9. Submit `transferFrom()` from the spender test wallet.
10. Print both transaction hashes.

If any safety check or transaction fails, the script prints the error and exits with a non-zero status.
