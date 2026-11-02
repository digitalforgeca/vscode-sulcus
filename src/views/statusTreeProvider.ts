import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { DaemonManager } from '../api/daemonManager';
import { sanitizeThreeWords } from '../utils/format';

export class StatusItem extends vscode.TreeItem {
  constructor(
    label: string,
    description?: string,
    icon: string = 'info',
    command?: vscode.Command,
    tooltip?: string
  ) {
    super(sanitizeThreeWords(label), vscode.TreeItemCollapsibleState.None);
    this.description = description ? sanitizeThreeWords(description) : undefined;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = command;
    this.tooltip = tooltip || (description ? `${label} ${description}` : label);
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
    const activeNs = config.namespace || 'default';

    let totalNodes = 0;
    let nsNodes = 0;
    let pinnedCount = 0;

    try {
      const stats = await this.client.getDashboardStats();
      if (stats) {
        totalNodes = stats.total_nodes || 0;
        pinnedCount = stats.pinned_count || 0;
        if (Array.isArray(stats.namespace_counts)) {
          const match = stats.namespace_counts.find((n: any) => n.namespace === activeNs);
          nsNodes = match ? match.count : 0;
        }
      }
    } catch {
      // fallback
    }

    if (nsNodes === 0 && isDaemonUp) {
      try {
        const paginated = await this.client.listNodesPaginated(activeNs, 1, 0);
        nsNodes = paginated.total;
      } catch {}
    }

    const items: vscode.TreeItem[] = [];

    // 1. Daemon Status
    items.push(
      new StatusItem(
        isDaemonUp ? 'Daemon Online' : 'Daemon Offline',
        isDaemonUp ? `Port ${config.daemonPort || 4203}` : 'Offline Engine',
        isDaemonUp ? 'pass-filled' : 'circle-slash',
        {
          command: isDaemonUp ? 'sulcus.restartDaemon' : 'sulcus.startDaemon',
          title: isDaemonUp ? 'Restart' : 'Start'
        },
        isDaemonUp ? 'Sulcus daemon is running and healthy' : 'Sulcus daemon is currently offline'
      )
    );

    // 2. Active Namespace
    items.push(
      new StatusItem(
        'Active Namespace',
        activeNs,
        'server',
        {
          command: 'sulcus.switchNamespace',
          title: 'Namespace'
        },
        `Current namespace is ${activeNs}`
      )
    );

    // 3. Namespace Nodes Count
    items.push(
      new StatusItem(
        'Namespace Nodes',
        `${nsNodes} nodes`,
        'database',
        {
          command: 'sulcus.refreshMemories',
          title: 'Refresh'
        },
        `${nsNodes} active memories in namespace ${activeNs}`
      )
    );

    // 4. Total Nodes in System
    items.push(
      new StatusItem(
        'Total Nodes',
        `${totalNodes || nsNodes} total`,
        'database',
        {
          command: 'sulcus.openDashboard',
          title: 'Dashboard'
        },
        `${totalNodes} total memories recorded in Sulcus`
      )
    );

    // 5. Pinned Nodes
    items.push(
      new StatusItem(
        'Pinned Nodes',
        `${pinnedCount} pinned`,
        'pin',
        undefined,
        `${pinnedCount} memories pinned permanently`
      )
    );

    // 6. Target Endpoint Mode
    items.push(
      new StatusItem(
        'Engine Mode',
        config.hybridMode ? 'Hybrid Local Cloud' : 'Cloud Only',
        'cloud',
        {
          command: 'sulcus.openDashboard',
          title: 'Dashboard'
        },
        'Sulcus Hybrid Local First Mode'
      )
    );

    return items;
  }
}
