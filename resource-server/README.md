# AgentPay x402 Resource Server

Reference/service implementation of an x402-protected resource that participates in AgentPay's paid-resource lifecycle.

## Role

The resource server demonstrates the provider side of:

```text
client GET
 -> 402 payment requirements
 -> AgentPay authorizes/creates payment payload
 -> client retries with payment proof
 -> resource server verifies/settles through facilitator
 -> paid response
```

The resource server is not the AgentPay policy engine. It presents the price/payment requirements and verifies the payment using the configured facilitator/profile.

## Security requirements

- canonical resource URL and payment requirements must remain stable for the intended purchase;
- amount, asset, network, payee, and resource binding must match what is verified;
- do not return paid content until the configured verification/settlement rule succeeds;
- use bounded request/response behavior;
- keep provider/facilitator secrets server-side;
- do not treat a client claim of payment as evidence.

## Development

Use `.env.example` for configuration. The workspace is included in repository typecheck/test/build and container-build verification.

Synthetic resource content is suitable for development/testing but should not be presented as real customer data or external market evidence.

See [`../docs/04-detailed-workflows.md`](../docs/04-detailed-workflows.md).
