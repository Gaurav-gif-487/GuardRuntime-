import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AdversarialRedTeamHarness } from '../src/guardruntime/adversarial';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const experimentsDir = path.resolve(__dirname, '..', 'experiments');

async function main() {
  console.log('=== RUNNING PHASE H: ADVERSARIAL RED-TEAM HARDENING SUITE ===\n');

  if (!fs.existsSync(experimentsDir)) {
    fs.mkdirSync(experimentsDir, { recursive: true });
  }

  const report = await AdversarialRedTeamHarness.runAllAttacks();

  const outPath = path.join(experimentsDir, 'adversarial-results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`Total Attacks Attempted: ${report.totalAttacksAttempted}`);
  console.log(`Attacks Thwarted: ${report.attacksThwartedCount}`);
  console.log(`Defense Success Rate: ${(report.defenseSuccessRate * 100).toFixed(2)}%`);
  console.log(`Open Vulnerability Findings: ${report.openFindingsCount}\n`);

  console.log('--- INDIVIDUAL ATTACK OUTCOMES ---');
  for (const atk of report.attackResults) {
    console.log(`[${atk.attackThwarted ? 'THWARTED' : 'EXPLOITED'}] ${atk.attackId}: ${atk.attackName}`);
    console.log(`   Target: ${atk.targetInvariant} | Category: ${atk.category}`);
    console.log(`   Blocked At: ${atk.blockingStage} | Verdict: ${atk.actualVerdict}`);
    console.log(`   Explanation: ${atk.defenseExplanation.slice(0, 100)}...`);
  }

  console.log('\n--- MULTI-AGENT & CONCURRENCY RESOLUTION ---');
  console.log(`Multi-Agent Taint: ${report.multiAgentTaintAnalysis.secondOrderTaintResolution}`);
  console.log(`Concurrency Test: ${report.concurrencyRaceAnalysis.summary}`);

  console.log(`\n -> Saved complete adversarial report to ${outPath}`);
}

main().catch(err => {
  console.error('Adversarial evaluation error:', err);
  process.exit(1);
});
