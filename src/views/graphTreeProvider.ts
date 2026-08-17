import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { EntityRelation } from '../types';

export class GraphItem extends vscode.TreeItem {
  constructor(
    public readonly entity: EntityRelation,
    public readonly isEntityHeader: boolean = true,
    public readonly memoryChild?: { id: string; memory_type: string; pointer_summary: string; label?: string }
  ) {
    super(
      isEntityHeader
        ? `${entity.entity_name} (${entity.entity_type})`
        : `[${memoryChild?.memory_type || 'semantic'}] ${memoryChild?.pointer_summary || memoryChild?.label || ''}`,
      isEntityHeader
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    if (isEntityHeader) {
      this.contextValue = 'graphEntity';
      this.description = `${entity.related_memories?.length || 0} relations`;
      this.iconPath = new vscode.ThemeIcon('type-hierarchy');
      this.tooltip = `Entity: ${entity.entity_name}\nType: ${entity.entity_type}`;
    } else {
      this.contextValue = 'graphRelation';
      this.iconPath = new vscode.ThemeIcon('link');
      this.tooltip = `Memory ID: ${memoryChild?.id}\n${memoryChild?.pointer_summary || memoryChild?.label}`;
    }
  }
}

export class GraphTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: SulcusClient;
  private cachedEntities: EntityRelation[] = [];

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
      // Query graph visualization or hot node entities
      try {
        const config = this.client.getConfig();
        const hotNodes = await this.client.getHotNodes(config.namespace, 15);
        const entityWords: string[] = [];

        for (const n of hotNodes) {
          const words = (n.pointer_summary || n.label)
            .split(/\W+/)
            .filter((w) => w.length > 4 && !/^(about|where|which|there|these|those|should|could|would)$/i.test(w));
          entityWords.push(...words.slice(0, 3));
        }

        const uniqueWords = Array.from(new Set(entityWords)).slice(0, 10);
        if (uniqueWords.length > 0) {
          const res = await this.client.getEntityContext(uniqueWords, config.namespace, 5);
          this.cachedEntities = res.entities || [];
        } else {
          this.cachedEntities = [];
        }
      } catch {
        this.cachedEntities = [];
      }

      if (this.cachedEntities.length === 0) {
        const empty = new vscode.TreeItem('No graph entities discovered yet');
        empty.iconPath = new vscode.ThemeIcon('info');
        empty.description = 'Entities form automatically as memories connect';
        return [empty];
      }

      return this.cachedEntities.map((e) => new GraphItem(e, true));
    }

    if (element instanceof GraphItem && element.isEntityHeader) {
      const rels = element.entity.related_memories || [];
      return rels.map((m) => new GraphItem(element.entity, false, m));
    }

    return [];
  }
}
