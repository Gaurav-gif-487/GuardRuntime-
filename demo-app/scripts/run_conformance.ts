import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProtocolConformanceSuite } from '../src/guardruntime/conformance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const experimentsDir = path.resolve(__dirname, '..', 'experiments');

async function main() {
  console.log('=== RUNNING PHASE J: PROTOCOL CONFORMANCE TEST SUITE ===\n');

  if (!fs.existsSync(experimentsDir)) {
    fs.mkdirSync(experimentsDir, { recursive: true });
  }

  const report = await ProtocolConformanceSuite.runConformanceSuite();
  const outPath = path.join(experimentsDir, 'conformance-results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`Spec Version: ${report.specVersion}`);
  console.log(`Requirements Checked: ${report.totalRequirements}`);
  console.log(`Requirements Passed: ${report.requirementsPassed}`);
  console.log(`Conformance Rate: ${(report.conformanceRate * 100).toFixed(2)}%`);
  console.log(`Overall Status: ${report.overallStatus}\n`);

  console.log('--- DETAILED CONFORMANCE CHECKLIST ---');
  for (const item of report.results) {
    console.log(`[${item.passed ? 'PASS' : 'FAIL'}] ${item.reqId}: ${item.name} (${item.invariantMapping})`);
    console.log(`   Section: ${item.section}`);
    console.log(`   Details: ${item.details}`);
  }

  console.log(`\n -> Saved Conformance Report to ${outPath}`);
}

main().catch(err => {
  console.error('Conformance runner error:', err);
  process.exit(1);
});
