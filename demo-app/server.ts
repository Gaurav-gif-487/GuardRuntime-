import express from 'express';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import { GuardRuntimePipeline } from './src/guardruntime/pipeline';
import { McpSecurityGateway, McpJsonRpcRequest } from './src/guardruntime/mcp-gateway';
import { runGeneralizationBenchmark } from './src/guardruntime/eval/generalization';
import { runCacheSavingsBenchmark } from './src/guardruntime/eval/cache-savings';
import { runTlc } from './src/guardruntime/tlc-runner';
import { AdversarialRedTeamHarness } from './src/guardruntime/adversarial';
import { ProtocolConformanceSuite } from './src/guardruntime/conformance';
import { ExecutionContext, ToolAction, Principal, PolicySet } from './src/guardruntime/types';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Global Pipeline Instance
  const globalPipeline = new GuardRuntimePipeline();
  const mcpGateway = new McpSecurityGateway(globalPipeline);

  // Mutable Server State
  let runtimeHealth: 'HEALTHY' | 'DEGRADED' | 'MAINTENANCE' = 'HEALTHY';

  // --- API ROUTES ---

  // Health endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      runtimeHealth,
      uptimeSec: Math.floor(process.uptime()),
      telemetry: globalPipeline.telemetry
    });
  });

  // Toggle Health State (for Fail-Closed live demonstration)
  app.post('/api/health/set', (req, res) => {
    const { health } = req.body;
    if (['HEALTHY', 'DEGRADED', 'MAINTENANCE'].includes(health)) {
      runtimeHealth = health;
    }
    res.json({ runtimeHealth });
  });

  // Evaluate Action via 11-Stage Pipeline
  app.post('/api/pipeline/evaluate', async (req, res) => {
    try {
      const { action, principal, activePolicies, confirmationTokenId, cacheEnabled } = req.body;

      const defaultPrincipal: Principal = principal || {
        id: 'agent-devops-01',
        name: 'DevOps Automation Agent',
        role: 'agent',
        tenantId: 'tenant-acme-prod',
        capabilities: ['infra:read:*', 'infra:deploy:staging']
      };

      const defaultPolicies: PolicySet[] = activePolicies || [
        {
          id: 'default-sec-policy',
          version: '1.0.0',
          name: 'Standard Security Policy',
          tenantId: defaultPrincipal.tenantId,
          rules: [
            {
              id: 'r-read',
              name: 'Allow Read Actions',
              description: 'Permits read-only queries',
              effect: 'ALLOW',
              matchActionTypes: ['READ'],
              priority: 10
            },
            {
              id: 'r-confirm-deploy',
              name: 'Confirm Deployments',
              description: 'Requires human confirmation for deployment actions',
              effect: 'CONFIRM',
              matchToolNames: ['infra.deploy'],
              priority: 30
            },
            {
              id: 'r-deny-shell',
              name: 'Deny Shell Execution',
              description: 'Blocks raw shell execution',
              effect: 'DENY',
              matchToolNames: ['system.executeCommand', 'shell.exec'],
              priority: 99
            }
          ]
        }
      ];

      const context: ExecutionContext = {
        tenantId: defaultPrincipal.tenantId,
        principal: defaultPrincipal,
        currentBudgetRemaining: 5000,
        hourlyActionCount: 12,
        runtimeHealth,
        activePolicies: defaultPolicies,
        capabilityGrants: globalPipeline.getCapabilityEngine().getGrantsForPrincipal(defaultPrincipal.id),
        time: Date.now(),
        cacheEnabled: cacheEnabled !== undefined ? cacheEnabled : true
      };

      const trace = await globalPipeline.executePipeline(action, context, confirmationTokenId);
      res.json({ success: true, trace });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Issue Human Confirmation Token
  app.post('/api/pipeline/issue-confirmation', (req, res) => {
    const { actionFingerprint, principalId, tenantId, authorizedBy } = req.body;
    const token = globalPipeline.issueConfirmation(
      actionFingerprint || 'fingerprint-default',
      principalId || 'agent-devops-01',
      tenantId || 'tenant-acme-prod',
      authorizedBy || 'SecOps Approver'
    );
    res.json({ success: true, token });
  });

  // Run 6-Split Generalization Benchmark
  app.post('/api/eval/run-splits', async (req, res) => {
    try {
      const { seed, countPerSplit } = req.body;
      const report = await runGeneralizationBenchmark(seed || 42, countPerSplit || 20);
      res.json({ success: true, report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Run Cache Savings Benchmark
  app.post('/api/eval/cache-benchmark', async (req, res) => {
    try {
      const { repetitions } = req.body;
      const report = await runCacheSavingsBenchmark(repetitions || 40);
      res.json({ success: true, report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Run Adversarial Red-Team Suite (Phase H)
  app.post('/api/eval/adversarial', async (req, res) => {
    try {
      const report = await AdversarialRedTeamHarness.runAllAttacks();
      res.json({ success: true, report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Run Protocol Conformance Suite (Phase J)
  app.get('/api/eval/conformance', async (req, res) => {
    try {
      const report = await ProtocolConformanceSuite.runConformanceSuite(globalPipeline);
      res.json({ success: true, report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Run Formal Model Checker — actually spawns TLC (tla2tools.jar). This can
  // fail (missing jar/JVM) and does so explicitly rather than fabricating a
  // result; the client must show that failure, not silently substitute one.
  app.get('/api/formal/model-check', (req, res) => {
    try {
      const result = runTlc();
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get Audit Chain & Tamper Verification
  app.get('/api/audit/chain', (req, res) => {
    const ledger = globalPipeline.getAuditLedger();
    const blocks = ledger.getBlocks();
    const verification = ledger.verifyIntegrity();
    res.json({ blocks, verification });
  });

  // Simulate Tamper Attack on Audit Chain
  app.post('/api/audit/tamper', (req, res) => {
    const { blockIndex } = req.body;
    const ledger = globalPipeline.getAuditLedger();
    ledger.simulateTamperAttack(blockIndex !== undefined ? blockIndex : 1);
    const verification = ledger.verifyIntegrity();
    res.json({ success: true, verification, blocks: ledger.getBlocks() });
  });

  // Reset Audit Chain
  app.post('/api/audit/reset', (req, res) => {
    globalPipeline.getAuditLedger().resetLedger();
    res.json({ success: true, blocks: globalPipeline.getAuditLedger().getBlocks() });
  });

  // MCP Gateway JSON-RPC Endpoint
  app.post('/api/mcp/gateway', async (req, res) => {
    try {
      const mcpRequest: McpJsonRpcRequest = req.body;
      const { confirmationTokenId, principal } = req.query;

      const context: ExecutionContext = {
        tenantId: (principal as string) || 'tenant-mcp-default',
        principal: {
          id: (principal as string) || 'agent-mcp-client',
          name: 'MCP Client Agent',
          role: 'agent',
          tenantId: 'tenant-mcp-default',
          capabilities: ['infra:read:*', 'infra:deploy:staging']
        },
        currentBudgetRemaining: 5000,
        hourlyActionCount: 3,
        runtimeHealth,
        activePolicies: [],
        capabilityGrants: globalPipeline.getCapabilityEngine().getGrantsForPrincipal('agent-devops-01'),
        time: Date.now(),
        cacheEnabled: true
      };

      const mcpResponse = await mcpGateway.handleMcpRequest(
        mcpRequest,
        context,
        confirmationTokenId as string | undefined
      );

      res.json(mcpResponse);
    } catch (err: any) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: { code: -32603, message: `Internal server error: ${err.message}` }
      });
    }
  });

  // Download Codebase and Research Assets ZIP (Binary Stream)
  app.get(['/api/export/zip', '/api/download-zip'], async (req, res) => {
    try {
      const rootDir = process.cwd();
      const zip = new JSZip();
      const ignoredDirs = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.npm', 'states']);
      const ignoredFiles = new Set(['.DS_Store', 'guardruntime-complete.zip', 'tla2tools.jar']);

      function addDirectoryToZip(currentDir: string, zipFolder: JSZip) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (!ignoredDirs.has(entry.name)) {
              const nestedFolder = zipFolder.folder(entry.name);
              if (nestedFolder) {
                addDirectoryToZip(fullPath, nestedFolder);
              }
            }
          } else if (entry.isFile()) {
            if (!ignoredFiles.has(entry.name) && !entry.name.endsWith('.jar')) {
              const fileData = fs.readFileSync(fullPath);
              zipFolder.file(entry.name, fileData);
            }
          }
        }
      }

      addDirectoryToZip(rootDir, zip);
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      // Also persist to rootDir
      fs.writeFileSync(path.join(rootDir, 'guardruntime-complete.zip'), zipBuffer);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="guardruntime-complete.zip"');
      res.setHeader('Content-Length', zipBuffer.length);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(zipBuffer);
    } catch (err: any) {
      console.error('Error generating project ZIP:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Base64 export for browser iframe download compatibility
  app.get('/api/export/zip-base64', async (req, res) => {
    try {
      const rootDir = process.cwd();
      const zip = new JSZip();
      const ignoredDirs = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.npm', 'states']);
      const ignoredFiles = new Set(['.DS_Store', 'guardruntime-complete.zip', 'tla2tools.jar']);

      function addDirectoryToZip(currentDir: string, zipFolder: JSZip) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (!ignoredDirs.has(entry.name)) {
              const nestedFolder = zipFolder.folder(entry.name);
              if (nestedFolder) {
                addDirectoryToZip(fullPath, nestedFolder);
              }
            }
          } else if (entry.isFile()) {
            if (!ignoredFiles.has(entry.name) && !entry.name.endsWith('.jar')) {
              const fileData = fs.readFileSync(fullPath);
              zipFolder.file(entry.name, fileData);
            }
          }
        }
      }

      addDirectoryToZip(rootDir, zip);
      const base64Data = await zip.generateAsync({
        type: 'base64',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      res.json({ success: true, base64: base64Data, filename: 'guardruntime-complete.zip' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- VITE MIDDLEWARE SETUP ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GuardRuntime Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
