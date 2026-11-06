import { SHA256, MerkleTree } from './sha256';
import { AuditBlock, DecisionVerdict } from './types';

export interface MerkleInclusionProof {
  leafHash: string;
  leafIndex: number;
  rootHash: string;
  siblings: Array<{ position: 'left' | 'right'; hash: string }>;
}

export interface BlindedAuditCommitment {
  commitmentHash: string;
  salt: string;
  tenantId: string;
  decisionId: string;
  verdict: DecisionVerdict;
  timestamp: number;
}

export class AuditLedger {
  private blocks: AuditBlock[] = [];
  private pcrRegister: string = SHA256.hash('GENESIS_PCR_GUARD_RUNTIME_V1');
  private blindedCommitments: Map<string, BlindedAuditCommitment> = new Map();

  constructor() {
    this.createGenesisBlock();
  }

  private createGenesisBlock() {
    const genesisDigest = SHA256.hash('GENESIS_AUDIT_BLOCK_INITIALIZER');
    const genesisBlock: AuditBlock = {
      index: 0,
      timestamp: Date.now(),
      decisionId: 'GENESIS_DECISION',
      tenantId: 'SYSTEM',
      principalId: 'SYSTEM',
      actionDigest: genesisDigest,
      verdict: 'ALLOW',
      riskScore: 0.0,
      previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
      merkleRoot: genesisDigest,
      pcrRegisterHash: this.pcrRegister,
      blockHash: ''
    };

    genesisBlock.blockHash = this.computeBlockHash(genesisBlock);
    this.blocks.push(genesisBlock);
  }

  public recordDecision(
    decisionId: string,
    tenantId: string,
    principalId: string,
    actionPayload: any,
    verdict: DecisionVerdict,
    riskScore: number
  ): AuditBlock {
    const prevBlock = this.blocks[this.blocks.length - 1];
    const actionDigest = SHA256.hash(JSON.stringify(actionPayload));

    // Extend PCR state (PCR_n = H(PCR_{n-1} || actionDigest || verdict))
    this.pcrRegister = SHA256.hash(this.pcrRegister + actionDigest + verdict);

    // Build Merkle root of the record fields
    const tree = new MerkleTree([
      decisionId,
      tenantId,
      principalId,
      actionDigest,
      verdict,
      riskScore.toString(),
      prevBlock.blockHash
    ]);

    const newBlock: AuditBlock = {
      index: this.blocks.length,
      timestamp: Date.now(),
      decisionId,
      tenantId,
      principalId,
      actionDigest,
      verdict,
      riskScore,
      previousHash: prevBlock.blockHash,
      merkleRoot: tree.getRoot(),
      pcrRegisterHash: this.pcrRegister,
      blockHash: ''
    };

    newBlock.blockHash = this.computeBlockHash(newBlock);
    this.blocks.push(newBlock);

    // Generate confidential blinded hash commitment (tamper-evident verification anchor)
    const salt = SHA256.hash(`${Date.now()}:${Math.random()}:${decisionId}`).slice(0, 16);
    const commitmentHash = SHA256.hash(`${JSON.stringify(actionPayload)}:${salt}`);
    this.blindedCommitments.set(decisionId, {
      commitmentHash,
      salt,
      tenantId,
      decisionId,
      verdict,
      timestamp: newBlock.timestamp
    });

    return newBlock;
  }

  private computeBlockHash(block: AuditBlock): string {
    const serialized = `${block.index}|${block.timestamp}|${block.decisionId}|${block.tenantId}|${block.principalId}|${block.actionDigest}|${block.verdict}|${block.riskScore}|${block.previousHash}|${block.merkleRoot}|${block.pcrRegisterHash}`;
    return SHA256.hash(serialized);
  }

  public getBlocks(): AuditBlock[] {
    return [...this.blocks];
  }

  public getLatestBlock(): AuditBlock {
    return this.blocks[this.blocks.length - 1];
  }

  public getPcrRegister(): string {
    return this.pcrRegister;
  }

  /**
   * Generates an O(log N) Merkle Inclusion Proof for a specific block
   */
  public generateInclusionProof(blockIndex: number): MerkleInclusionProof | null {
    if (blockIndex < 0 || blockIndex >= this.blocks.length) {
      return null;
    }

    const blockHashes = this.blocks.map(b => b.blockHash);
    const leafHash = SHA256.hash(blockHashes[blockIndex]);
    const tree = new MerkleTree(blockHashes);
    const rootHash = tree.getRoot();
    const proof = tree.getProof(blockIndex);

    return {
      leafHash,
      leafIndex: blockIndex,
      rootHash,
      siblings: proof
    };
  }

  /**
   * Cryptographically verifies an O(log N) Merkle Inclusion Proof
   */
  public static verifyInclusionProof(proof: MerkleInclusionProof): boolean {
    return MerkleTree.verifyProof(proof.leafHash, proof.siblings, proof.rootHash);
  }

  /**
   * Generates a confidential blinded audit proof:
   * Proves that a specific decision was recorded with verdict V without leaking the raw action payload.
   */
  public getBlindedCommitment(decisionId: string): BlindedAuditCommitment | null {
    return this.blindedCommitments.get(decisionId) || null;
  }

  public static verifyBlindedCommitment(
    commitment: BlindedAuditCommitment,
    actionPayload: any
  ): boolean {
    const computed = SHA256.hash(`${JSON.stringify(actionPayload)}:${commitment.salt}`);
    return computed === commitment.commitmentHash;
  }

  /**
   * Cryptographic verification of the entire ledger chain.
   * Checks every hash link, PCR extension, and block integrity.
   */
  public verifyIntegrity(): { isValid: boolean; brokenAtIndex?: number; errorReason?: string; verifiedBlockCount: number } {
    if (this.blocks.length === 0) {
      return { isValid: false, errorReason: 'Empty ledger', verifiedBlockCount: 0 };
    }

    let runningPcr = SHA256.hash('GENESIS_PCR_GUARD_RUNTIME_V1');

    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];

      // Check block self-hash
      const expectedBlockHash = this.computeBlockHash(block);
      if (block.blockHash !== expectedBlockHash) {
        return {
          isValid: false,
          brokenAtIndex: i,
          errorReason: `Block #${i} hash mismatch: recorded [${block.blockHash.slice(0, 10)}] vs calculated [${expectedBlockHash.slice(0, 10)}]`,
          verifiedBlockCount: i
        };
      }

      // Check chain continuity
      if (i > 0) {
        const prevBlock = this.blocks[i - 1];
        if (block.previousHash !== prevBlock.blockHash) {
          return {
            isValid: false,
            brokenAtIndex: i,
            errorReason: `Block #${i} previousHash link broken: points to [${block.previousHash.slice(0, 10)}] but Block #${i - 1} hash is [${prevBlock.blockHash.slice(0, 10)}]`,
            verifiedBlockCount: i
          };
        }

        // Verify PCR extension
        runningPcr = SHA256.hash(runningPcr + block.actionDigest + block.verdict);
        if (block.pcrRegisterHash !== runningPcr) {
          return {
            isValid: false,
            brokenAtIndex: i,
            errorReason: `Block #${i} PCR register divergence detected`,
            verifiedBlockCount: i
          };
        }
      }
    }

    return { isValid: true, verifiedBlockCount: this.blocks.length };
  }

  /**
   * Simulation of an adversarial database tampering attack on historical records
   */
  public simulateTamperAttack(blockIndex: number, fakeVerdict: DecisionVerdict = 'ALLOW') {
    if (blockIndex >= 0 && blockIndex < this.blocks.length) {
      const target = this.blocks[blockIndex];
      target.verdict = fakeVerdict;
      target.actionDigest = SHA256.hash('TAMPERED_MALICIOUS_PAYLOAD');
    }
  }

  public resetLedger() {
    this.blocks = [];
    this.pcrRegister = SHA256.hash('GENESIS_PCR_GUARD_RUNTIME_V1');
    this.blindedCommitments.clear();
    this.createGenesisBlock();
  }
}
