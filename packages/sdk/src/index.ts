export type AgentPayClientOptions = { baseUrl: string; apiKey: string; fetch?: typeof globalThis.fetch };
export type PaidRequest = { resourceUrl: string; purpose?: string; maxAmountAtomic?: string };
export type PaymentIntent = { id: string; status: "DENIED"|"APPROVAL_PENDING"|"SETTLED"|string; resourceUrl: string; approval?: { id: string; status: string } | null };

export class AgentPayError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

export class AgentPayClient {
  private readonly requestFetch: typeof globalThis.fetch;
  constructor(private readonly options: AgentPayClientOptions) { this.requestFetch = options.fetch ?? globalThis.fetch; }
  private async request<T>(path: string, init?: RequestInit): Promise<T> { const response=await this.requestFetch(new URL(path,this.options.baseUrl),{...init,headers:{authorization:`Bearer ${this.options.apiKey}`,"content-type":"application/json",...init?.headers}});const body=await response.json();if(!response.ok)throw new AgentPayError(response.status,body.code??"REQUEST_FAILED",body.detail??"AgentPay request failed");return body.data as T; }
  createPaidRequest(agentId:string,input:PaidRequest,idempotencyKey=crypto.randomUUID()){return this.request<PaymentIntent>(`/api/v1/agents/${agentId}/paid-requests`,{method:"POST",headers:{"idempotency-key":idempotencyKey},body:JSON.stringify(input)});}
  getPaymentIntent(intentId:string){return this.request<PaymentIntent>(`/api/v1/payment-intents/${intentId}`);}
  listResources(){return this.request<Array<{id:string;name:string;endpoint:string;category:string}>>("/api/v1/resources");}
}
