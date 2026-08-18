import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SulcusConfiguration } from '../types';

export function getSulcusConfig(): SulcusConfiguration {
  const wsConfig = vscode.workspace.getConfiguration('sulcus');

  let serverUrl =
    wsConfig.get<string>('serverUrl') ||
    process.env.SULCUS_SERVER_URL ||
    process.env.SULCUS_BASE_URL ||
    'https://api.sulcus.ca';

  let apiKey =
    wsConfig.get<string>('apiKey') ||
    process.env.SULCUS_API_KEY ||
    '';

  let namespace =
    wsConfig.get<string>('namespace') ||
    process.env.SULCUS_NAMESPACE ||
    'default';

  let oidcIssuer =
    wsConfig.get<string>('oidcIssuer') ||
    process.env.SULCUS_OIDC_ISSUER ||
    'http://127.0.0.1:8082/realms/master';

  const binPath =
    wsConfig.get<string>('binPath') ||
    'sulcus';

  const autoStartDaemon =
    wsConfig.get<boolean>('autoStartDaemon', true);

  const daemonPort =
    wsConfig.get<number>('daemonPort', 4203);

  const hybridMode =
    wsConfig.get<boolean>('hybridMode', true);

  const maxSummaryChars =
    wsConfig.get<number>('maxSummaryChars', 500);

  const autoRecallLimit =
    wsConfig.get<number>('autoRecallLimit', 10);

  // Fall back to ~/.config/sulcus/sulcus.ini if apiKey or serverUrl not provided
  try {
    const homeDir = os.homedir();
    const iniPath = path.join(homeDir, '.config', 'sulcus', 'sulcus.ini');
    if (fs.existsSync(iniPath)) {
      const lines = fs.readFileSync(iniPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

        if (trimmed.startsWith('server_url') && (!wsConfig.get<string>('serverUrl') && !process.env.SULCUS_SERVER_URL)) {
          const val = trimmed.split('=').slice(1).join('=').trim();
          if (val) serverUrl = val;
        }
        if (trimmed.startsWith('server_api_key') && (!wsConfig.get<string>('apiKey') && !process.env.SULCUS_API_KEY)) {
          const val = trimmed.split('=').slice(1).join('=').trim();
          if (val) apiKey = val;
        }
        if (trimmed.startsWith('namespace') && (!wsConfig.get<string>('namespace') && !process.env.SULCUS_NAMESPACE)) {
          const val = trimmed.split('=').slice(1).join('=').trim();
          if (val) namespace = val;
        }
      }
    }
  } catch {
    // Ignore ini read errors
  }

  return {
    serverUrl,
    apiKey,
    namespace,
    oidcIssuer,
    binPath,
    autoStartDaemon,
    daemonPort,
    hybridMode,
    maxSummaryChars,
    autoRecallLimit
  };
}

export function setSulcusNamespace(namespace: string): Thenable<void> {
  const wsConfig = vscode.workspace.getConfiguration('sulcus');
  return wsConfig.update('namespace', namespace, vscode.ConfigurationTarget.Global);
}
