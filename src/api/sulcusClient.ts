import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import {
  CreateMemoryParams,
  DashboardStats,
  EntityContextResponse,
  FeedbackParams,
  MemoryNode,
  SearchOptions,
  SearchResult,
  SIULabelResponse,
  SulcusConfiguration
} from '../types';
import { getSulcusConfig } from '../config/config';

export class SulcusClient {
  private config: SulcusConfiguration;

  constructor(config?: SulcusConfiguration) {
    this.config = config || getSulcusConfig();
  }

  public updateConfig(config: SulcusConfiguration) {
    this.config = config;
  }

  public getConfig(): SulcusConfiguration {
    return this.config;
  }

  public async isDaemonRunning(): Promise<boolean> {
    const port = this.config.daemonPort || 4203;
    const url = `http://127.0.0.1:${port}/api/v1/admin/dashboard`;
    return new Promise((resolve) => {
      const req = http.get(url, (res) => {
        resolve(res.statusCode !== 502 && res.statusCode !== 404);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(400, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  public async resolveTargetBaseUrl(): Promise<string> {
    if (this.config.hybridMode) {
      const daemonOk = await this.isDaemonRunning();
      if (daemonOk) {
        return `http://127.0.0.1:${this.config.daemonPort || 4203}`;
      }
    }
    return this.config.serverUrl;
  }

  public async getOidcToken(): Promise<string> {
    const homeDir = os.homedir();
    const tokenDir = path.join(homeDir, '.config', 'sulcus');
    const tokenPath = path.join(tokenDir, 'oidc_token.json');

    try {
      if (fs.existsSync(tokenPath)) {
        const raw = fs.readFileSync(tokenPath, 'utf8');
        const cached = JSON.parse(raw);
        if (cached.access_token && cached.expires_at > Date.now() + 60000) {
          return cached.access_token;
        }
      }
    } catch {
      // Ignore cache read errors
    }

    return new Promise((resolve, reject) => {
      const issuer = this.config.oidcIssuer || 'http://127.0.0.1:8082/realms/master';
      let url: URL;
      try {
        url = new URL(issuer.replace(/\/+$/, '') + '/protocol/openid-connect/token');
      } catch (err: any) {
        return reject(new Error(`Invalid OIDC Issuer URL: ${err.message}`));
      }

      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;
      const bodyStr = 'client_id=sulcus-cli&username=admin&password=changeme&grant_type=password&scope=openid';

      const options = {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(bodyStr))
        },
        timeout: 5000
      };

      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (!res.statusCode || res.statusCode >= 400) {
            return reject(new Error(`OIDC fetch failed (HTTP ${res.statusCode}): ${raw.substring(0, 150)}`));
          }
          try {
            const data = JSON.parse(raw);
            if (data.access_token) {
              data.expires_at = Date.now() + (data.expires_in * 1000);
              if (!fs.existsSync(tokenDir)) {
                fs.mkdirSync(tokenDir, { recursive: true });
              }
              fs.writeFileSync(tokenPath, JSON.stringify(data));
              resolve(data.access_token);
            } else {
              reject(new Error('No access token returned in OIDC response'));
            }
          } catch (e: any) {
            reject(new Error(`Failed to parse OIDC response: ${e.message}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OIDC request timed out'));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  public async request<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    apiPath: string,
    body?: any
  ): Promise<T> {
    const baseUrl = await this.resolveTargetBaseUrl();
    let token = this.config.apiKey;

    // Local dev fallback to OIDC token if talking to remote server without API key
    if ((token === 'icarus-sulcus-2026' || !token) && baseUrl === this.config.serverUrl) {
      try {
        token = await this.getOidcToken();
      } catch {
        // Fallback to configured key
      }
    }

    return new Promise<T>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(baseUrl.replace(/\/+$/, '') + apiPath);
      } catch (e: any) {
        return reject(new Error(`Invalid URL: ${baseUrl}${apiPath}`));
      }

      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      if (bodyStr !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
      }

      const options = {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 8000
      };

      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (!res.statusCode || res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${raw.substring(0, 300)}`));
          }
          if (!raw || raw.trim() === '') {
            return resolve(null as any);
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw as any);
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out (${method} ${apiPath})`));
      });

      if (bodyStr !== undefined) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  // ── High-Level Endpoints ──────────────────────────────────────────────

  public async search(options: SearchOptions): Promise<SearchResult[]> {
    const payload = {
      query: options.query,
      context: options.context || '',
      limit: options.limit || this.config.autoRecallLimit || 10,
      namespace: options.namespace || this.config.namespace || 'default',
      min_heat: options.min_heat,
      memory_type: options.memory_type
    };

    const res = await this.request('POST', '/api/v1/agent/search', payload);
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.results && Array.isArray(res.results)) return res.results;
    if (res.items && Array.isArray(res.items)) return res.items;
    if (res.nodes && Array.isArray(res.nodes)) return res.nodes;
    return [];
  }

  public async getEntityContext(
    entityNames: string[],
    namespace?: string,
    limit: number = 3
  ): Promise<EntityContextResponse> {
    try {
      return await this.request<EntityContextResponse>('POST', '/api/v1/agent/entity-context', {
        entity_names: entityNames.slice(0, 10),
        namespace: namespace || this.config.namespace || 'default',
        limit
      });
    } catch {
      return { entities: [] };
    }
  }

  public async labelWithSIU(text: string, qualityOnly: boolean = false): Promise<SIULabelResponse> {
    try {
      const res = await this.request<SIULabelResponse>('POST', '/api/v2/siu/label', {
        text,
        quality_only: qualityOnly
      });
      return res || { quality: 'store', memory_type: 'semantic' };
    } catch {
      // If SIU endpoint is unavailable, default to storing as semantic
      return { quality: 'store', memory_type: 'semantic' };
    }
  }

  public async createNode(params: CreateMemoryParams): Promise<MemoryNode> {
    const payload = {
      label: params.label,
      memory_type: params.memory_type || 'semantic',
      is_pinned: params.is_pinned ?? false,
      decay_class: params.decay_class || 'normal',
      initial_heat: params.initial_heat,
      min_heat: params.min_heat,
      namespace: params.namespace || this.config.namespace || 'default',
      tags: params.tags,
      metadata: params.metadata
    };
    return await this.request<MemoryNode>('POST', '/api/v1/agent/nodes', payload);
  }

  public async getNode(id: string): Promise<MemoryNode> {
    return await this.request<MemoryNode>('GET', `/api/v1/agent/nodes/${id}`);
  }

  public async patchNode(id: string, updates: Partial<CreateMemoryParams>): Promise<MemoryNode> {
    return await this.request<MemoryNode>('PATCH', `/api/v1/agent/nodes/${id}`, updates);
  }

  public async deleteNode(id: string): Promise<boolean> {
    try {
      await this.request('DELETE', `/api/v1/agent/nodes/${id}`);
      return true;
    } catch {
      return false;
    }
  }

  public async listNodes(namespace?: string, limit: number = 50, offset: number = 0): Promise<MemoryNode[]> {
    const ns = namespace || this.config.namespace || 'default';
    const res = await this.request('GET', `/api/v1/agent/nodes?namespace=${encodeURIComponent(ns)}&limit=${limit}&offset=${offset}`);
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.nodes && Array.isArray(res.nodes)) return res.nodes;
    if (res.items && Array.isArray(res.items)) return res.items;
    return [];
  }

  public async getHotNodes(namespace?: string, limit: number = 20): Promise<MemoryNode[]> {
    const ns = namespace || this.config.namespace || 'default';
    const res = await this.request('GET', `/api/v1/agent/hot_nodes?namespace=${encodeURIComponent(ns)}&limit=${limit}`);
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.nodes && Array.isArray(res.nodes)) return res.nodes;
    if (res.items && Array.isArray(res.items)) return res.items;
    return [];
  }

  public async sendFeedback(params: FeedbackParams): Promise<boolean> {
    try {
      await this.request('POST', '/api/v1/feedback', params);
      return true;
    } catch {
      return false;
    }
  }

  public async getDashboardStats(): Promise<DashboardStats> {
    return await this.request<DashboardStats>('GET', '/api/v1/admin/dashboard');
  }

  public async getGraphVisualization(): Promise<any> {
    return await this.request('GET', '/api/v1/admin/visualize/graph');
  }
}
