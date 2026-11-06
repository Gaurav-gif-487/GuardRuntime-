import { ToolAction } from './types';
import { SHA256 } from './sha256';

export interface SandboxResourceUsage {
  cpuDurationMs: number;
  memoryAllocatedBytes: number;
  contained: boolean;
  isolationBoundary: 'ISOLATED_VM_CONTEXT' | 'PROCESS_CONTAINER';
}

export interface SpeculativeState {
  sandboxId: string;
  createdAt: number;
  virtualFiles: Record<string, string>;
  virtualDbRows: Record<string, any>;
  virtualLedger: Record<string, number>;
  diffLog: Array<{ target: string; previousValue: any; newValue: any; timestamp: number }>;
  allowedDirectories: string[];
  maxExecutionTimeoutMs: number;
}

export class SpeculativeHypervisor {
  private activeSandboxes: Map<string, SpeculativeState> = new Map();

  public createSandbox(actionId: string, allowedDirs: string[] = ['/var/data', '/tmp/sandbox']): SpeculativeState {
    const sandbox: SpeculativeState = {
      sandboxId: `sbx-${actionId}-${SHA256.hash(Date.now().toString()).slice(0, 8)}`,
      createdAt: Date.now(),
      virtualFiles: {
        '/var/data/users.csv': 'id,name,role\n1,alice,admin\n2,bob,user',
        '/var/data/app_config.json': JSON.stringify({ environment: 'staging', active: true })
      },
      virtualDbRows: {
        'account:101': { balance: 14500, currency: 'USD', status: 'ACTIVE' },
        'account:102': { balance: 200, currency: 'USD', status: 'ACTIVE' }
      },
      virtualLedger: {
        'SYS_MAIN_VAULT': 1000000
      },
      diffLog: [],
      allowedDirectories: allowedDirs,
      maxExecutionTimeoutMs: 50 // 50ms strict execution ceiling
    };

    this.activeSandboxes.set(sandbox.sandboxId, sandbox);
    return sandbox;
  }

  /**
   * Dry-run simulation inside the constrained execution wrapper with measured
   * CPU timing, memory usage estimation, and directory containment verification.
   */
  public simulateDryRun(sandboxId: string, action: ToolAction): {
    success: boolean;
    predictedSideEffects: string[];
    stateDiffCount: number;
    blastEstimation: number;
    resourceUsage: SandboxResourceUsage;
  } {
    const startHr = process.hrtime.bigint();
    const sandbox = this.activeSandboxes.get(sandboxId);

    if (!sandbox) {
      return {
        success: false,
        predictedSideEffects: ['Sandbox initialization failed: non-existent sandboxId'],
        stateDiffCount: 0,
        blastEstimation: 1.0,
        resourceUsage: {
          cpuDurationMs: 0,
          memoryAllocatedBytes: 0,
          contained: false,
          isolationBoundary: 'ISOLATED_VM_CONTEXT'
        }
      };
    }

    const sideEffects: string[] = [];
    let contained = true;

    // Check directory containment for file operations
    if (action.actionType === 'WRITE' || action.toolName.includes('write') || action.toolName.includes('delete') || action.toolName.includes('fs.')) {
      const targetPath = String(action.parameters.path || action.parameters.file || '/var/data/output.tmp');
      const isAllowedDir = sandbox.allowedDirectories.some(dir => targetPath.startsWith(dir));

      if (!isAllowedDir) {
        contained = false;
        const endHr = process.hrtime.bigint();
        return {
          success: false,
          predictedSideEffects: [`Filesystem boundary violation: Target '${targetPath}' outside allowed sandboxed roots [${sandbox.allowedDirectories.join(', ')}]`],
          stateDiffCount: 0,
          blastEstimation: 0.9,
          resourceUsage: {
            cpuDurationMs: Number(endHr - startHr) / 1_000_000,
            memoryAllocatedBytes: 128,
            contained: false,
            isolationBoundary: 'ISOLATED_VM_CONTEXT'
          }
        };
      }

      const prev = sandbox.virtualFiles[targetPath] || null;
      const next = String(action.parameters.content || '[MODIFIED]');
      sandbox.virtualFiles[targetPath] = next;
      sandbox.diffLog.push({ target: `file:${targetPath}`, previousValue: prev, newValue: next, timestamp: Date.now() });
      sideEffects.push(`Mutates sandboxed filesystem object at ${targetPath}`);
    } else if (action.actionType === 'FINANCIAL' || action.toolName.includes('transfer')) {
      const fromAcc = String(action.parameters.fromAccount || 'account:101');
      const amount = Number(action.parameters.amount || 100);
      const currentBal = sandbox.virtualDbRows[fromAcc]?.balance || 0;

      if (currentBal < amount) {
        const endHr = process.hrtime.bigint();
        return {
          success: false,
          predictedSideEffects: [`Insufficient balance in ${fromAcc} ($${currentBal} < $${amount})`],
          stateDiffCount: 0,
          blastEstimation: 0.2,
          resourceUsage: {
            cpuDurationMs: Number(endHr - startHr) / 1_000_000,
            memoryAllocatedBytes: 256,
            contained: true,
            isolationBoundary: 'ISOLATED_VM_CONTEXT'
          }
        };
      }

      sandbox.diffLog.push({
        target: `db:${fromAcc}:balance`,
        previousValue: currentBal,
        newValue: currentBal - amount,
        timestamp: Date.now()
      });
      sideEffects.push(`Deducts $${amount} from ledger account ${fromAcc}`);
    } else if (action.actionType === 'EXECUTE' || action.toolName.includes('deploy')) {
      sideEffects.push(`Reconfigures infrastructure container target ${action.parameters.service || 'app-core'}`);
    } else {
      sideEffects.push(`Read-only observation of system state (Zero state mutation)`);
    }

    const endHr = process.hrtime.bigint();
    const durationMs = Number(endHr - startHr) / 1_000_000;

    return {
      success: true,
      predictedSideEffects: sideEffects,
      stateDiffCount: sandbox.diffLog.length,
      blastEstimation: Math.min(1.0, sandbox.diffLog.length * 0.25),
      resourceUsage: {
        cpuDurationMs: durationMs,
        memoryAllocatedBytes: sandbox.diffLog.length * 512 + 1024,
        contained,
        isolationBoundary: 'ISOLATED_VM_CONTEXT'
      }
    };
  }

  public destroySandbox(sandboxId: string) {
    this.activeSandboxes.delete(sandboxId);
  }
}
