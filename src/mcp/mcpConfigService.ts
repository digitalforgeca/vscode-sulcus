import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SulcusClient } from '../api/sulcusClient';
import { DaemonManager } from '../api/daemonManager';

export class McpConfigService {
  private client: SulcusClient;
  private daemon: DaemonManager;

  constructor(client: SulcusClient, daemon: DaemonManager) {
    this.client = client;
    this.daemon = daemon;
  }

  public update(client: SulcusClient, daemon: DaemonManager) {
    this.client = client;
    this.daemon = daemon;
  }

  public async configureMcp(): Promise<void> {
    const transportPick = await vscode.window.showQuickPick(
      [
        {
          label: 'Local Daemon SSE (Recommended)',
          description: 'http://127.0.0.1:4203/sse',
          detail: 'Zero latency, uses local background daemon, supports local vectors & embeddings.',
          transport: 'local-sse'
        },
        {
          label: 'Local Binary (Stdio)',
          description: 'command: "sulcus", args: ["stdio"]',
          detail: 'Direct stdio process connection to locally installed sulcus binary.',
          transport: 'local-stdio'
        },
        {
          label: 'NPX Runner (Stdio)',
          description: 'command: "npx", args: ["-y", "@digitalforgestudios/sulcus", "stdio"]',
          detail: 'Runs via npm/npx on demand without pre-installing the binary.',
          transport: 'npx-stdio'
        }
      ],
      { title: 'Select Sulcus MCP Transport Method' }
    );

    if (!transportPick) return;

    const locationPick = await vscode.window.showQuickPick(
      [
        {
          label: 'Workspace (.vscode/mcp.json)',
          description: 'Configure MCP for current workspace only',
          target: 'workspace-vscode'
        },
        {
          label: 'Cursor Workspace (.cursor/mcp.json)',
          description: 'Configure MCP for Cursor editor',
          target: 'workspace-cursor'
        },
        {
          label: 'Global User (~/.vscode/mcp.json)',
          description: 'Configure MCP across all VS Code projects',
          target: 'global-vscode'
        }
      ],
      { title: 'Select Target Configuration File' }
    );

    if (!locationPick) return;

    const config = this.client.getConfig();
    const binPath = this.daemon.findSulcusBinary() || 'sulcus';

    let targetFilePath = '';
    if (locationPick.target === 'workspace-vscode') {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open. Cannot write .vscode/mcp.json.');
        return;
      }
      const vscodeDir = path.join(folders[0].uri.fsPath, '.vscode');
      if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
      targetFilePath = path.join(vscodeDir, 'mcp.json');
    } else if (locationPick.target === 'workspace-cursor') {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open. Cannot write .cursor/mcp.json.');
        return;
      }
      const cursorDir = path.join(folders[0].uri.fsPath, '.cursor');
      if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
      targetFilePath = path.join(cursorDir, 'mcp.json');
    } else {
      const globalVscodeDir = path.join(os.homedir(), '.vscode');
      if (!fs.existsSync(globalVscodeDir)) fs.mkdirSync(globalVscodeDir, { recursive: true });
      targetFilePath = path.join(globalVscodeDir, 'mcp.json');
    }

    // Read existing config if present
    let mcpJson: any = { servers: {} };
    if (fs.existsSync(targetFilePath)) {
      try {
        mcpJson = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'));
        if (!mcpJson.servers && !mcpJson.mcpServers) {
          mcpJson.servers = {};
        }
      } catch {
        mcpJson = { servers: {} };
      }
    }

    const isCursorFormat = locationPick.target === 'workspace-cursor' || mcpJson.mcpServers !== undefined;
    const serverKey = isCursorFormat ? 'mcpServers' : 'servers';
    if (!mcpJson[serverKey]) mcpJson[serverKey] = {};

    if (transportPick.transport === 'local-sse') {
      mcpJson[serverKey]['sulcus'] = {
        type: 'sse',
        url: `http://127.0.0.1:${config.daemonPort || 4203}/sse`
      };
    } else if (transportPick.transport === 'local-stdio') {
      mcpJson[serverKey]['sulcus'] = {
        type: 'stdio',
        command: binPath,
        args: ['stdio'],
        env: {
          SULCUS_SERVER_URL: config.serverUrl || 'https://api.sulcus.ca',
          SULCUS_NAMESPACE: config.namespace || 'default',
          ...(config.apiKey ? { SULCUS_API_KEY: config.apiKey } : {})
        }
      };
    } else if (transportPick.transport === 'npx-stdio') {
      mcpJson[serverKey]['sulcus'] = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@digitalforgestudios/sulcus', 'stdio'],
        env: {
          SULCUS_SERVER_URL: config.serverUrl || 'https://api.sulcus.ca',
          SULCUS_NAMESPACE: config.namespace || 'default',
          ...(config.apiKey ? { SULCUS_API_KEY: config.apiKey } : {})
        }
      };
    }

    fs.writeFileSync(targetFilePath, JSON.stringify(mcpJson, null, 2), 'utf8');

    const doc = await vscode.workspace.openTextDocument(targetFilePath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Configured Sulcus MCP in ${path.basename(targetFilePath)} ✓`);
  }
}
