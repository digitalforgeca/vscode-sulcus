import * as vscode from 'vscode';
import { SulcusClient } from './api/sulcusClient';
import { DaemonManager } from './api/daemonManager';
import { RecallService } from './services/recallService';
import { CaptureService } from './services/captureService';
import { RulePromotionService } from './services/rulePromotionService';
import { MemoryTreeProvider } from './views/memoryTreeProvider';
import { StatusTreeProvider } from './views/statusTreeProvider';
import { GraphTreeProvider } from './views/graphTreeProvider';
import { registerLanguageModelTools } from './tools/lmTools';
import { registerCommands } from './commands/commands';
import { AuthManager } from './auth/authManager';
import { McpConfigService } from './mcp/mcpConfigService';
import { getSulcusConfig } from './config/config';
import { SulcusConfiguration } from './types';

let outputChannel: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let daemonManager: DaemonManager | undefined;
let sulcusClient: SulcusClient | undefined;
let authManager: AuthManager | undefined;
let memoryProvider: MemoryTreeProvider | undefined;
let statusProvider: StatusTreeProvider | undefined;
let graphProvider: GraphTreeProvider | undefined;
let statusTimer: NodeJS.Timeout | undefined;

export interface SulcusAPI {
  client: SulcusClient;
  daemon: DaemonManager;
  auth: AuthManager;
  recallService: RecallService;
  captureService: CaptureService;
  recallPrompt: (query: string, context?: string) => Promise<any>;
  captureText: (text: string) => Promise<any>;
  showOutput: () => void;
}

async function updateStatusBar() {
  if (!statusBarItem || !sulcusClient || !daemonManager) return;

  const isUp = await daemonManager.isDaemonHealthy();
  const config = sulcusClient.getConfig();

  if (isUp) {
    let count = 0;
    try {
      const nodes = await sulcusClient.listNodes(config.namespace, 50);
      count = nodes.length;
    } catch {}
    statusBarItem.text = `$(circuit-board) Sulcus: [${config.namespace}] (${count} nodes)`;
    statusBarItem.tooltip = `Sulcus Local Daemon: Online (Port ${config.daemonPort})\nNamespace: ${config.namespace}\nClick for quick actions`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = `$(circuit-board) Sulcus: [${config.namespace}] (Offline)`;
    statusBarItem.tooltip = `Sulcus Local Daemon: Offline\nClick to start daemon or switch mode`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<SulcusAPI> {
  outputChannel = vscode.window.createOutputChannel('Sulcus');
  outputChannel.appendLine('Activating Sulcus Memory & Context Sidecar for VS Code...');

  const config = getSulcusConfig();
  sulcusClient = new SulcusClient(config);
  daemonManager = new DaemonManager(config, outputChannel);

  const recallService = new RecallService(sulcusClient);
  const captureService = new CaptureService(sulcusClient);
  const promotionService = new RulePromotionService(sulcusClient);
  const mcpService = new McpConfigService(sulcusClient, daemonManager);

  memoryProvider = new MemoryTreeProvider(sulcusClient);
  statusProvider = new StatusTreeProvider(sulcusClient, daemonManager);
  graphProvider = new GraphTreeProvider(sulcusClient);

  authManager = new AuthManager(sulcusClient, daemonManager, () => {
    updateStatusBar().catch(() => {});
    memoryProvider?.refresh();
    statusProvider?.refresh();
    graphProvider?.refresh();
  });

  // Register URI Handler (vscode://digitalforge.sulcus-vscode/auth?key=...)
  context.subscriptions.push(vscode.window.registerUriHandler(authManager));

  // Register Tree Views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sulcus.views.memories', memoryProvider),
    vscode.window.registerTreeDataProvider('sulcus.views.status', statusProvider),
    vscode.window.registerTreeDataProvider('sulcus.views.graph', graphProvider)
  );

  // Register Status Bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'sulcus.searchMemories';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Periodic status bar & view refresh
  statusTimer = setInterval(() => {
    updateStatusBar().catch(() => {});
  }, 10000);

  // Initial update
  updateStatusBar().catch(() => {});

  // Register Commands
  registerCommands(
    context,
    sulcusClient,
    daemonManager,
    authManager,
    mcpService,
    recallService,
    captureService,
    promotionService,
    memoryProvider,
    statusProvider,
    graphProvider,
    outputChannel
  );

  // Register Language Model Tools (Copilot / LM API)
  registerLanguageModelTools(context, sulcusClient, recallService, captureService);

  // Auto-start local daemon if enabled
  if (config.autoStartDaemon) {
    daemonManager.ensureDaemonRunning().then((isHealthy) => {
      if (isHealthy) {
        outputChannel?.appendLine('Sulcus local daemon verified & ready ✓');
      }
      updateStatusBar().catch(() => {});
      memoryProvider?.refresh();
      statusProvider?.refresh();
      graphProvider?.refresh();
    }).catch(() => {});
  }

  // Watch for configuration updates
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sulcus')) {
        const newConfig = getSulcusConfig();
        sulcusClient?.updateConfig(newConfig);
        daemonManager?.updateConfig(newConfig);
        authManager?.update(sulcusClient!, daemonManager!);
        recallService.updateClient(sulcusClient!);
        captureService.updateClient(sulcusClient!);
        promotionService.updateClient(sulcusClient!);
        memoryProvider?.updateClient(sulcusClient!);
        statusProvider?.update(sulcusClient!, daemonManager!);
        graphProvider?.updateClient(sulcusClient!);
        updateStatusBar().catch(() => {});
      }
    })
  );

  outputChannel.appendLine('Sulcus VS Code extension fully initialized.');

  return {
    client: sulcusClient,
    daemon: daemonManager,
    auth: authManager,
    recallService,
    captureService,
    recallPrompt: (query, ctx) => recallService.recallForPrompt(query, ctx),
    captureText: (text) => captureService.captureText(text),
    showOutput: () => outputChannel?.show(true)
  };
}

export function deactivate() {
  if (statusTimer) {
    clearInterval(statusTimer);
  }
  if (authManager) {
    authManager.cleanup();
  }
  if (daemonManager) {
    daemonManager.stopDaemon().catch(() => {});
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
}
