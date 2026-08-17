# Sulcus — AI Memory & Context Engine (VS Code Extension)

A comprehensive VS Code extension bringing the full power of **Sulcus Memory-as-a-Service** directly into your editor, mirroring the architecture and capabilities of the native Antigravity (`sulcus-agy`) plugin.

Sulcus provides cognitive, thermodynamic persistent memory with knowledge graphs, semantic recall, SIU auto-capture, and bidirectional sync for developers and AI agents (such as GitHub Copilot and Antigravity).

---

## Key Features

### 1. Auto-Recall & Context Injection (`sulcus.recallContext`)
- **Semantic Search**: Searches Sulcus for high-relevance memories matching the current prompt, active file, or selected code.
- **Knowledge Graph Entity Context**: Automatically parses keywords and fetches multi-hop entity relationships and graph context.
- **Thermodynamic Heat Boost**: Fire-and-forget heat reinforcement for retrieved memories to keep relevant context hot.
- **Standardized XML Block**: Formats context into `<sulcus-memories>...</sulcus-memories>` ready for insertion, clipboard copying, or Copilot prompts.

### 2. Auto-Capture & SIU Labeling (`sulcus.captureSelection`, `sulcus.addMemoryInteractive`)
- **Intelligent Sanitization**: Strips bloated code blocks, conversational fillers, and repetitive greetings while preserving critical concepts.
- **SIU Quality Gate**: Evaluates input against Sulcus's Semantic Intelligence Unit (SIU) to verify utility and assign the appropriate memory type:
  - `semantic` — System concepts, architectural patterns, design decisions.
  - `fact` — Invariant facts, fixed URLs, environment requirements.
  - `preference` — User coding style, library preferences, formatting choices.
  - `procedural` — Step-by-step runbooks, deployment guides.
  - `episodic` — Session milestones and conversational summaries.
- **Thermodynamic Retention Tuning**: Pin critical memories (📌 `is_pinned: true`) to freeze them against thermodynamic decay, or configure custom decay curves (`fast`, `normal`, `slow`, `glacial`).

### 3. VS Code Language Model Tools API (Copilot Chat Integration)
Registers native VS Code Language Model Tools (`vscode.lm.registerTool`), enabling Copilot and agentic workflows to leverage Sulcus memory directly:
- `sulcus_recall` — Recalls relevant historical knowledge and graph relations.
- `sulcus_capture` — Evaluates and records new insights or architectural rules into memory.
- `sulcus_boost` — Increases the thermodynamic heat of useful memory nodes.
- `sulcus_forget` — Deprecates or deletes obsolete memory nodes.

### 4. Interactive Sidebar Explorer (`Sulcus Memory`)
- **Active Memories Explorer**: Browse memories categorized by type (`Pinned`, `Semantic`, `Facts`, `Preferences`, `Procedural`, `Episodic`) with real-time heat percentages (`[92% heat]`).
- **Knowledge Graph Explorer**: Inspect graph entities, classifications, and connected memory edges.
- **Engine & Daemon Status**: View local daemon health (Port 4203), active namespace, auth status, node counts, and quick actions.

### 5. Rule Promotion Workflow (`sulcus.promoteToRule`)
Implements the Sulcus promotion pipeline: promotes any ambient memory into a hard, project-wide rule saved into `.agents/rules/<rule_name>.md` and freezes the source memory in Sulcus.

---

## Commands

| Command | Title | Description |
| :--- | :--- | :--- |
| `sulcus.recallContext` | Auto-Recall Context | Recall relevant memories for active selection or prompt query |
| `sulcus.captureSelection` | Capture Selection | Sanitize & capture selection using SIU quality classification |
| `sulcus.addMemoryInteractive` | Add Memory Node (Wizard) | Step-by-step memory creation dialog |
| `sulcus.searchMemories` | Search Memories & Graph | QuickPick memory search with live preview and actions |
| `sulcus.boostMemory` | Boost Memory Heat (+15%) | Reinforces memory node heat |
| `sulcus.retractMemory` | Retract Memory Heat (-15%) | Cools down memory node heat |
| `sulcus.pinMemory` | Toggle Pin Status (📌) | Freezes memory against decay |
| `sulcus.forgetMemory` | Forget / Delete Memory | Deletes memory node |
| `sulcus.promoteToRule` | Promote Memory to Rule | Converts memory into `.agents/rules/*.md` |
| `sulcus.switchNamespace` | Switch Namespace | Changes active memory namespace |
| `sulcus.openDashboard` | Open Dashboard | Opens web or local control panel |
| `sulcus.startDaemon` | Start Local Daemon | Spawns background `sulcus serve` |
| `sulcus.restartDaemon` | Restart Local Daemon | Restarts local daemon |
| `sulcus.refreshMemories` | Refresh Views | Re-queries active memories and status |

---

## Configuration Settings

Configured in VS Code Settings (`Preferences > Settings > Sulcus`):

```json
{
  "sulcus.serverUrl": "https://api.sulcus.ca",
  "sulcus.apiKey": "",
  "sulcus.namespace": "default",
  "sulcus.oidcIssuer": "http://127.0.0.1:8082/realms/master",
  "sulcus.binPath": "sulcus",
  "sulcus.autoStartDaemon": true,
  "sulcus.daemonPort": 4203,
  "sulcus.hybridMode": true,
  "sulcus.autoRecallLimit": 10,
  "sulcus.maxSummaryChars": 500
}
```

*Note: Sulcus credentials are also automatically resolved from `~/.config/sulcus/sulcus.ini` and standard environment variables (`SULCUS_API_KEY`, `SULCUS_SERVER_URL`, `SULCUS_NAMESPACE`).*

---

## Architecture & Parity with `sulcus-agy`

| Feature | `sulcus-agy` (Antigravity CLI) | `vscode-sulcus` (VS Code Extension) |
| :--- | :--- | :--- |
| **Daemon Auto-Spawn** | `ensureLocalDaemon()` in `sulcus_api.js` | `DaemonManager.ensureDaemonRunning()` |
| **Recall Hook** | `recall.js` (`PreInvocation`) | `RecallService.recallForPrompt()` + LM Tool `sulcus_recall` |
| **Capture Hook** | `capture.js` (`Stop` / `PostInvocation`) | `CaptureService.captureText()` + LM Tool `sulcus_capture` |
| **SIU Quality Gate** | `/api/v2/siu/label` evaluation | Supported via `client.labelWithSIU()` |
| **Graph Expansion** | `/api/v1/agent/entity-context` | Supported in `RecallService` + Sidebar Graph View |
| **Thermodynamic Tuning** | Pinned status, decay curves, heat boost | Supported via TreeView actions, Wizard, and LM Tools |
| **Rule Promotion** | `.agents/rules/` promotion guideline | Interactive command `sulcus.promoteToRule` |
| **Hybrid Mode & OIDC** | Local daemon ping + Cerberus Keycloak OIDC | Full parity in `SulcusClient` |

---

## Building and Packaging

```bash
cd vscode-sulcus
npm install
npm run compile
```

To package into a `.vsix` file for installation:
```bash
npx @vscode/vsce package
```
