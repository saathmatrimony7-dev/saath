/**
 * Photo moderation behind an interface (P1-04). The mock approves by default
 * and rejects reported keys (tests drive it; P2 wires a real vision API with
 * the same contract). Moderation runs on the RE-ENCODED bytes — what we serve
 * is what we moderated.
 */
export interface ModerationVerdict {
  approved: boolean;
  labels: string[];
}

export interface ModerationProvider {
  moderate(key: string, imageBytes: Buffer): Promise<ModerationVerdict>;
}

export class MockModerationProvider implements ModerationProvider {
  private readonly reportedKeys = new Set<string>();

  /** Test/dev hook: mark a storage key as policy-violating before completion. */
  report(key: string): void {
    this.reportedKeys.add(key);
  }

  async moderate(key: string, _imageBytes: Buffer): Promise<ModerationVerdict> {
    if (this.reportedKeys.has(key)) {
      return { approved: false, labels: ['mock-reported'] };
    }
    return { approved: true, labels: [] };
  }
}

/** Real provider (vision API) lands in P2 behind this interface. */
export class HttpModerationProvider implements ModerationProvider {
  async moderate(): Promise<ModerationVerdict> {
    throw new Error('HttpModerationProvider lands in P2; use the mock provider');
  }
}
