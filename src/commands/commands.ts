import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { DaemonManager } from '../api/daemonManager';
import { RecallService } from '../services/recallService';
import { CaptureService } from '../services/captureService';
import { RulePromotionService } from '../services/rulePromotionService';
import { MemoryTreeProvider, MemoryItem } from '../views/memoryTreeProvider';
import { StatusTreeProvider } from '../views/statusTreeProvider';
import { GraphTreeProvider } from '../views/graphTreeProvider';
import { AuthManager } from '../auth/authManager';
import { McpConfigService } from '../mcp/mcpConfigService';
import { setSulcusNamespace } from '../config/config';
import { MemoryNode } from '../types';

export function registerCommands(
  context: vscode.ExtensionContext,
  client: SulcusClient,
  daemon: DaemonManager,
  authManager: AuthManager,
  mcpService: McpConfigService,
  recallService: RecallService,
  captureService: CaptureService,
  promotionService: RulePromotionService,
  memoryProvider: MemoryTreeProvider,
  statusProvider: StatusTreeProvider,
  graphProvider: GraphTreeProvider,
  outputChannel: vscode.OutputChannel
) {
  function refreshAll() {
    memoryProvider.refresh();
    statusProvider.refresh();
    graphProvider.refresh();
  }

  // ── Auto-Recall Commands ──────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.recallContext', async () => {
      const editor = vscode.window.activeTextEditor;
      let defaultQuery = editor ? editor.document.getText(editor.selection).trim() : '';
      if (!defaultQuery && editor) {
        defaultQuery = editor.document.lineAt(editor.selection.active.line).text.trim();
      }

      const query = await vscode.window.showInputBox({
        title: 'Sulcus: Auto-Recall Memories',
        prompt: 'Enter prompt, topic, or question to recall relevant context from Sulcus',
        value: defaultQuery || ''
      });

      if (!query) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Sulcus: Recalling relevant memories...',
          cancellable: false
        },
        async () => {
          const result = await recallService.recallForPrompt(query);
          if (!result.formattedBlock) {
            vscode.window.showInformationMessage('No relevant memories found in Sulcus.');
            return;
          }

          outputChannel.clear();
          outputChannel.appendLine(result.formattedBlock);
          outputChannel.show(true);

          const choice = await vscode.window.showInformationMessage(
            `Sulcus recalled ${result.memories.length} relevant memories!`,
            'Copy to Clipboard',
            'Insert at Cursor'
          );

          if (choice === 'Copy to Clipboard') {
            await vscode.env.clipboard.writeText(result.formattedBlock);
            vscode.window.showInformationMessage('Copied <sulcus-memories> context block to clipboard.');
          } else if (choice === 'Insert at Cursor' && editor) {
            editor.edit((editBuilder) => {
              editBuilder.insert(editor.selection.active, result.formattedBlock + '\n');
            });
          }
        }
      );
    })
  );

  // ── Capture Commands ──────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.captureSelection', async () => {
      await captureService.captureSelection();
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.addMemoryInteractive', async () => {
      await captureService.captureInteractive();
      refreshAll();
    })
  );

  // ── Search Commands ───────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.searchMemories', async () => {
      const q = await vscode.window.showInputBox({
        title: 'Sulcus: Search Memories',
        prompt: 'Search memories across semantics and graph'
      });
      if (!q) return;

      const results = await client.search({ query: q, limit: 20 });
      if (!results || results.length === 0) {
        vscode.window.showInformationMessage(`No memories matching "${q}".`);
        return;
      }

      const picks = results.map((r) => {
        const node = r.node || (r as any);
        const heat = node.current_heat !== undefined ? `${(node.current_heat * 100).toFixed(0)}%` : '??%';
        const type = node.memory_type || 'semantic';
        const pin = node.is_pinned ? '📌 ' : '';
        return {
          label: `${pin}[${type}] ${node.label || node.pointer_summary}`,
          description: `Heat: ${heat} | ID: ${node.id}`,
          detail: node.label,
          node: node as MemoryNode
        };
      });

      const selected = await vscode.window.showQuickPick(picks, {
        title: `Sulcus Search Results (${results.length} found)`,
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (selected) {
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Copy Content', action: 'copy_text' },
            { label: 'Copy Node ID', action: 'copy_id' },
            { label: 'Boost Heat (+15%)', action: 'boost' },
            { label: selected.node.is_pinned ? 'Unpin Memory' : 'Pin Memory (📌)', action: 'pin' },
            { label: 'Promote to Workspace Rule', action: 'promote' },
            { label: 'Delete / Forget Memory', action: 'delete' }
          ],
          { title: `Action for: ${selected.node.id}` }
        );

        if (action?.action === 'copy_text') {
          await vscode.env.clipboard.writeText(selected.node.label);
          vscode.window.showInformationMessage('Copied memory text to clipboard.');
        } else if (action?.action === 'copy_id') {
          await vscode.env.clipboard.writeText(selected.node.id);
          vscode.window.showInformationMessage(`Copied ID ${selected.node.id} to clipboard.`);
        } else if (action?.action === 'boost') {
          await client.sendFeedback({ node_id: selected.node.id, feedback_type: 'boost', strength: 0.15 });
          vscode.window.showInformationMessage(`Boosted memory heat for ${selected.node.id}.`);
          refreshAll();
        } else if (action?.action === 'pin') {
          await client.patchNode(selected.node.id, { is_pinned: !selected.node.is_pinned });
          vscode.window.showInformationMessage(`Updated pin status for ${selected.node.id}.`);
          refreshAll();
        } else if (action?.action === 'promote') {
          await promotionService.promoteMemoryToRule(selected.node);
          refreshAll();
        } else if (action?.action === 'delete') {
          const confirm = await vscode.window.showWarningMessage(
            `Delete memory ${selected.node.id}?`,
            { modal: true },
            'Delete'
          );
          if (confirm === 'Delete') {
            await client.deleteNode(selected.node.id);
            vscode.window.showInformationMessage(`Deleted memory ${selected.node.id}.`);
            refreshAll();
          }
        }
      }
    })
  );

  // ── Node Actions from TreeView ────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.boostMemory', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (!node?.id) return;
      await client.sendFeedback({ node_id: node.id, feedback_type: 'boost', strength: 0.15 });
      vscode.window.showInformationMessage(`Boosted heat for memory node ${node.id} 🔥`);
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.retractMemory', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (!node?.id) return;
      await client.sendFeedback({ node_id: node.id, feedback_type: 'retract', strength: 0.15 });
      vscode.window.showInformationMessage(`Retracted heat for memory node ${node.id} ❄️`);
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.pinMemory', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (!node?.id) return;
      const newPin = !node.is_pinned;
      await client.patchNode(node.id, { is_pinned: newPin, decay_class: newPin ? 'glacial' : 'normal' });
      vscode.window.showInformationMessage(`${newPin ? 'Pinned 📌' : 'Unpinned'} memory node ${node.id}`);
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.forgetMemory', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (!node?.id) return;
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to forget memory ${node.id}?`,
        { modal: true },
        'Forget'
      );
      if (confirm === 'Forget') {
        await client.deleteNode(node.id);
        vscode.window.showInformationMessage(`Forgot memory ${node.id}.`);
        refreshAll();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.copyMemoryId', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (node?.id) {
        await vscode.env.clipboard.writeText(node.id);
        vscode.window.showInformationMessage(`Copied ID "${node.id}" to clipboard.`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.copyMemoryText', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (node?.label) {
        await vscode.env.clipboard.writeText(node.label);
        vscode.window.showInformationMessage('Copied memory text to clipboard.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.promoteToRule', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (node) {
        await promotionService.promoteMemoryToRule(node);
        refreshAll();
      }
    })
  );

  // ── Namespace & Engine Controls ───────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.switchNamespace', async () => {
      const current = client.getConfig().namespace || 'default';
      const ns = await vscode.window.showInputBox({
        title: 'Sulcus: Switch Namespace',
        prompt: 'Enter namespace name for memory isolation',
        value: current
      });
      if (ns && ns !== current) {
        await setSulcusNamespace(ns);
        vscode.window.showInformationMessage(`Switched active Sulcus namespace to "${ns}".`);
        refreshAll();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.openDashboard', async () => {
      const baseUrl = await client.resolveTargetBaseUrl();
      const dashboardUrl = `${baseUrl.replace(/\/+$/, '')}/api/v1/admin/dashboard`;
      await vscode.env.openExternal(vscode.Uri.parse(baseUrl));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.startDaemon', async () => {
      const ok = await daemon.startDaemon();
      if (ok) {
        vscode.window.showInformationMessage('Sulcus daemon started successfully ✓');
      } else {
        vscode.window.showErrorMessage('Failed to start Sulcus daemon. Check Output channel.');
      }
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.restartDaemon', async () => {
      const ok = await daemon.restartDaemon();
      if (ok) {
        vscode.window.showInformationMessage('Sulcus daemon restarted successfully ✓');
      } else {
        vscode.window.showErrorMessage('Failed to restart Sulcus daemon.');
      }
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.configureMcp', async () => {
      await mcpService.configureMcp();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.openLocalPanel', async () => {
      const config = client.getConfig();
      const port = config.daemonPort || 4203;
      const url = `http://127.0.0.1:${port}/`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.signIn', async () => {
      await authManager.signIn();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.signOut', async () => {
      await authManager.signOut();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.refreshMemories', () => {
      memoryProvider.refresh();
      statusProvider.refresh();
      graphProvider.refresh();
    })
  );

  // ── Legacy Backward-Compatible Commands ───────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.summarizeSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      const text = editor ? editor.document.getText(editor.selection).trim() : '';
      if (!text) {
        vscode.window.showWarningMessage('Please select text to summarize.');
        return;
      }
      const cleaned = captureService.cleanText(text);
      outputChannel.appendLine('--- sulcus summary ---');
      outputChannel.appendLine(cleaned + '\n');
      outputChannel.show(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.addMemory', async () => {
      await captureService.captureSelection();
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.showActiveIndex', async () => {
      try {
        const nodes = await client.listNodes(undefined, 20);
        outputChannel.clear();
        outputChannel.appendLine('--- sulcus active index ---');
        outputChannel.appendLine(JSON.stringify(nodes, null, 2));
        outputChannel.show(true);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to show active index: ${e.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.describeTools', () => {
      const manifest = {
        tools: [
          { name: 'sulcus_recall', description: 'Semantic recall of relevant memories & graph relations' },
          { name: 'sulcus_capture', description: 'Record new memory node with SIU quality assessment' },
          { name: 'sulcus_boost', description: 'Thermodynamic heat boost for retrieved memory' },
          { name: 'sulcus_forget', description: 'Remove / forget memory node' },
          { name: 'record_memory', description: 'MCP tool: add memory node' },
          { name: 'search_memory', description: 'MCP tool: semantic search' },
          { name: 'sync_now', description: 'MCP tool: trigger cloud sync' }
        ]
      };
      outputChannel.clear();
      outputChannel.appendLine('--- sulcus tools manifest ---');
      outputChannel.appendLine(JSON.stringify(manifest, null, 2));
      outputChannel.show(true);
    })
  );

  // ── In-App Update Command ───────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.checkForUpdates', async () => {
      const currentVersion = context.extension?.packageJSON?.version || '1.2.0';

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Sulcus: Checking for extension updates...',
          cancellable: false
        },
        async () => {
          try {
            const https = await import('https');
            const fs = await import('fs');
            const path = await import('path');
            const os = await import('os');

            const releaseData: any = await new Promise((resolve, reject) => {
              const req = https.get(
                'https://api.github.com/repos/digitalforgeca/vscode-sulcus/releases/latest',
                {
                  headers: {
                    'User-Agent': 'Sulcus-VSCode-Updater',
                    'Accept': 'application/vnd.github.v3+json'
                  }
                },
                (res) => {
                  let body = '';
                  res.on('data', (d) => (body += d));
                  res.on('end', () => {
                    try {
                      resolve(JSON.parse(body));
                    } catch (e) {
                      reject(e);
                    }
                  });
                }
              );
              req.on('error', reject);
              req.setTimeout(8000, () => {
                req.destroy();
                reject(new Error('GitHub API request timed out'));
              });
            });

            if (!releaseData || !releaseData.tag_name) {
              vscode.window.showInformationMessage(`Sulcus is currently at v${currentVersion}. No release updates found.`);
              return;
            }

            const latestTag = releaseData.tag_name.replace(/^v/, '');
            const vsixAsset = releaseData.assets?.find((a: any) => a.name && a.name.endsWith('.vsix'));

            if (latestTag === currentVersion) {
              const choice = await vscode.window.showInformationMessage(
                `Sulcus is up to date (v${currentVersion}).`,
                'Reinstall Latest'
              );
              if (choice !== 'Reinstall Latest') return;
            }

            if (!vsixAsset || !vsixAsset.browser_download_url) {
              vscode.window.showErrorMessage(`Release v${latestTag} found, but no VSIX package asset was attached.`);
              return;
            }

            const confirm = await vscode.window.showInformationMessage(
              `A new version of Sulcus is available: v${latestTag} (current: v${currentVersion}). Would you like to install it now?`,
              'Update Now'
            );

            if (confirm !== 'Update Now') return;

            // Download VSIX
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `Sulcus: Downloading v${latestTag}...`,
                cancellable: false
              },
              async () => {
                const tempDir = os.tmpdir();
                const tempVsixPath = path.join(tempDir, `sulcus-vscode-${latestTag}.vsix`);

                await new Promise<void>((resolve, reject) => {
                  const download = (url: string) => {
                    https.get(url, { headers: { 'User-Agent': 'Sulcus-VSCode-Updater' } }, (res) => {
                      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        download(res.headers.location);
                        return;
                      }
                      if (res.statusCode !== 200) {
                        reject(new Error(`Failed to download VSIX: HTTP ${res.statusCode}`));
                        return;
                      }
                      const fileStream = fs.createWriteStream(tempVsixPath);
                      res.pipe(fileStream);
                      fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                      });
                    }).on('error', reject);
                  };
                  download(vsixAsset.browser_download_url);
                });

                // Install VSIX via VS Code command
                await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(tempVsixPath));

                const reload = await vscode.window.showInformationMessage(
                  `🎉 Successfully updated Sulcus to v${latestTag}! Please reload the window to apply changes.`,
                  'Reload Window'
                );

                if (reload === 'Reload Window') {
                  await vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
              }
            );
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to check for updates: ${err.message}`);
          }
        }
      );
    })
  );
}
