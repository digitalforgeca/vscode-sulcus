import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { MemoryNode, MemoryType } from '../types';

export class MemoryItem extends vscode.TreeItem {
  constructor(
    public readonly node: MemoryNode,
    public readonly isGroupHeader: boolean = false,
    public readonly groupType?: MemoryType | 'pinned',
    public readonly groupCount?: number
  ) {
    super(
      isGroupHeader
        ? `${(groupType || 'all').toUpperCase()} (${groupCount ?? 0})`
        : node.label.length > 60
        ? `${node.label.substring(0, 60)}...`
        : node.label,
      isGroupHeader
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    if (isGroupHeader) {
      this.contextValue = 'memoryGroup';
      this.iconPath = new vscode.ThemeIcon(
        groupType === 'pinned'
          ? 'pinned'
          : groupType === 'fact'
          ? 'shield'
          : groupType === 'preference'
          ? 'heart'
          : groupType === 'procedural'
          ? 'list-ordered'
          : groupType === 'episodic'
          ? 'history'
          : 'symbol-keyword'
      );
    } else {
      this.contextValue = 'memoryItem';
      const heatVal = node.current_heat !== undefined ? `${Math.round(node.current_heat * 100)}%` : '??%';
      const pinStr = node.is_pinned ? '📌 ' : '';
      this.description = `${pinStr}[${heatVal} heat]`;
      this.tooltip = new vscode.MarkdownString(
        `### [${node.memory_type || 'semantic'}] Memory\n\n` +
        `**ID**: \`${node.id}\`\n\n` +
        `**Heat**: ${heatVal} | **Pinned**: ${node.is_pinned ? 'Yes' : 'No'} | **Decay**: ${node.decay_class || 'normal'}\n\n` +
        `**Namespace**: \`${node.namespace || 'default'}\`\n\n` +
        `---\n\n${node.label}`
      );
      this.tooltip.isTrusted = true;

      this.iconPath = new vscode.ThemeIcon(
        node.is_pinned
          ? 'pinned'
          : node.memory_type === 'fact'
          ? 'shield'
          : node.memory_type === 'preference'
          ? 'heart'
          : node.memory_type === 'procedural'
          ? 'list-ordered'
          : node.memory_type === 'episodic'
          ? 'history'
          : 'bookmark'
      );
    }
  }
}

export class MemoryPropertyItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string = 'info') {
    super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'memoryProperty';
    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = `${label}: ${value}`;
  }
}

export class MemoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: SulcusClient;
  private cachedNodes: MemoryNode[] = [];

  constructor(client: SulcusClient) {
    this.client = client;
  }

  public updateClient(client: SulcusClient) {
    this.client = client;
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      // Root level: fetch all active nodes and group by memory type
      try {
        this.cachedNodes = await this.client.listNodes(undefined, 100);
      } catch {
        this.cachedNodes = [];
      }

      if (this.cachedNodes.length === 0) {
        const empty = new vscode.TreeItem('No memories found in current namespace');
        empty.iconPath = new vscode.ThemeIcon('info');
        empty.description = 'Use "Sulcus: Capture Memory" to create one';
        return [empty];
      }

      const groups: Array<{ type: MemoryType | 'pinned'; count: number }> = [];
      const pinnedCount = this.cachedNodes.filter((n) => n.is_pinned).length;
      if (pinnedCount > 0) {
        groups.push({ type: 'pinned', count: pinnedCount });
      }

      const types: MemoryType[] = ['semantic', 'fact', 'preference', 'procedural', 'episodic'];
      for (const t of types) {
        const count = this.cachedNodes.filter((n) => (n.memory_type || 'semantic') === t && !n.is_pinned).length;
        if (count > 0) {
          groups.push({ type: t, count });
        }
      }

      return groups.map(
        (g) =>
          new MemoryItem(
            { id: g.type, label: g.type },
            true,
            g.type,
            g.count
          )
      );
    }

    if (element instanceof MemoryItem && element.isGroupHeader) {
      const gType = element.groupType;
      let matching: MemoryNode[] = [];
      if (gType === 'pinned') {
        matching = this.cachedNodes.filter((n) => n.is_pinned);
      } else {
        matching = this.cachedNodes.filter(
          (n) => (n.memory_type || 'semantic') === gType && !n.is_pinned
        );
      }

      // Sort by heat descending
      matching.sort((a, b) => (b.current_heat ?? 0) - (a.current_heat ?? 0));
      return matching.map((n) => new MemoryItem(n, false));
    }

    if (element instanceof MemoryItem && !element.isGroupHeader) {
      const node = element.node;
      const heat = node.current_heat !== undefined ? `${(node.current_heat * 100).toFixed(1)}%` : 'N/A';
      return [
        new MemoryPropertyItem('ID', node.id, 'key'),
        new MemoryPropertyItem('Type', node.memory_type || 'semantic', 'tag'),
        new MemoryPropertyItem('Heat', heat, 'flame'),
        new MemoryPropertyItem('Pinned', node.is_pinned ? 'Yes' : 'No', 'pinned'),
        new MemoryPropertyItem('Decay Class', node.decay_class || 'normal', 'history'),
        new MemoryPropertyItem('Namespace', node.namespace || 'default', 'server-process'),
        new MemoryPropertyItem('Full Content', node.label, 'quote')
      ];
    }

    return [];
  }
}
