import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { DaemonManager } from '../api/daemonManager';

export class StatusItem extends vscode.TreeItem {
  constructor(
    label: string,
    description?: string,
    icon: string = 'info',
    command?: vscode.Command,
    tooltip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = command;
    this.tooltip = tooltip || (description ? `${label}: ${description}` : label);
  }
}

export class StatusTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: SulcusClient;
  private daemon: DaemonManager;

  constructor(client: SulcusClient, daemon: DaemonManager) {
    this.client = client;
    this.daemon = daemon;
  }

  public update(client: SulcusClient, daemon: DaemonManager) {
    this.client = client;
    this.daemon = daemon;
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return [];

    const config = this.client.getConfig();
    const isDaemonUp = await this.daemon.isDaemonHealthy();
    const targetBase = await this.client.resolveTargetBaseUrl();

    let nodeCount = 0;
    try {
      const nodes = await this.client.listNodes(config.namespace, 100);
      nodeCount = nodes.length;
    } catch {
      // ignore
    }

    const items: vscode.TreeItem[] = [];

    // 1. Daemon Status
    items.push(
      new StatusItem(
        'Local Daemon',
        isDaemonUp ? `Running (Port ${config.daemonPort || 4203})` : 'Offline',
        isDaemonUp ? 'pass-filled' : 'error',
        {
          command: isDaemonUp ? 'sulcus.restartDaemon' : 'sulcus.startDaemon',
          title: isDaemonUp ? 'Restart Daemon' : 'Start Daemon'
        },
        isDaemonUp ? 'Click to restart daemon' : 'Click to start local daemon'
      )
    );

    // 2. Target Endpoint
    items.push(
      new StatusItem(
        'Active Endpoint',
        targetBase,
        'cloud',
        {
          command: 'sulcus.openDashboard',
          title: 'Open Dashboard'
        },
        'Click to open Sulcus Web/Local Dashboard'
      )
    );

    // 3. Namespace
    items.push(
      new StatusItem(
        'Namespace',
        config.namespace || 'default',
        'server-process',
        {
          command: 'sulcus.switchNamespace',
          title: 'Switch Namespace'
        },
        'Click to switch active namespace'
      )
    );

    // 4. Memory Nodes Count
    items.push(
      new StatusItem(
        'Memories Count',
        `${nodeCount} active nodes`,
        'database',
        {
          command: 'sulcus.refreshMemories',
          title: 'Refresh Memories'
        }
      )
    );

    // 5. Auth / API Key Status
    const hasKey = !!config.apiKey;
    items.push(
      new StatusItem(
        hasKey ? 'Signed In' : 'Sign In',
        hasKey ? 'Click to Sign Out' : undefined,
        hasKey ? 'pass-filled' : 'sign-in',
        {
          command: hasKey ? 'sulcus.signOut' : 'sulcus.signIn',
          title: hasKey ? 'Sign Out' : 'Sign In'
        },
        hasKey ? 'Click to Sign Out' : 'Click to Sign In'
      )
    );

    // 6. Extension Version & In-App Update
    items.push(
      new StatusItem(
        'Extension Version',
        'v1.2.0 (Check for Updates)',
        'package',
        {
          command: 'sulcus.checkForUpdates',
          title: 'Check for Updates'
        },
        'Sulcus VS Code Extension v1.2.0\nClick to check for updates or install latest GitHub release'
      )
    );

    // 7. Quick Actions
    items.push(
      new StatusItem(
        'Auto-Recall Context',
        undefined,
        'sparkle',
        {
          command: 'sulcus.recallContext',
          title: 'Recall Context'
        }
      )
    );

    items.push(
      new StatusItem(
        'Capture Selection',
        undefined,
        'add',
        {
          command: 'sulcus.captureSelection',
          title: 'Capture Selection'
        }
      )
    );

    return items;
  }
}
