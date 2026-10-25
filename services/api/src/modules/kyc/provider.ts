/**
 * KYC providers (P2-01, DESIGN.md D1). The vendor is undecided; the interface
 * is not. Mock = scripted in dev/test (refused in production, like the other
 * mock vendors). IDfy = reference real implementation (config-only swap).
 *
 * The provider only STARTS a check; the RESULT always arrives through the
 * signature-verified webhook — Core never polls user KYC data.
 */
export interface StartKycInput {
  userId: string;
  type: 'id' | 'id_liveness' | 'employment';
}

export interface KycProvider {
  readonly name: string;
  start(input: StartKycInput): Promise<{ providerRef: string }>;
}

/** Dev/test provider: registers the check; tests deliver results via webhook. */
export class MockKycProvider implements KycProvider {
  readonly name = 'mock';
  readonly started: { userId: string; type: string; providerRef: string }[] = [];

  async start(input: StartKycInput): Promise<{ providerRef: string }> {
    const providerRef = `mock-kyc-${input.userId.slice(0, 8)}-${this.started.length}-${input.type}`;
    this.started.push({ ...input, providerRef });
    return { providerRef };
  }
}

/** IDfy reference implementation (task init). Inactive until configured. */
export class IdfyKycProvider implements KycProvider {
  readonly name = 'idfy';

  constructor(
    private readonly accountId: string,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://qa.idfy.in',
  ) {}

  async start(input: StartKycInput): Promise<{ providerRef: string }> {
    const res = await fetch(`${this.baseUrl}/v3/tasks`, {
      method: 'POST',
      headers: {
        'account-id': this.accountId,
        'api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task_id: `${input.userId}-${input.type}`,
        group_id: 'saath-kyc',
        workflow: input.type === 'employment' ? 'employment' : 'id_verification',
      }),
    });
    if (!res.ok) throw new Error(`IDfy task creation failed with status ${res.status}`);
    const body = (await res.json()) as { request_id?: string };
    if (!body.request_id) throw new Error('IDfy response missing request_id');
    return { providerRef: body.request_id };
  }
}
