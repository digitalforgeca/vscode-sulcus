# Sulcus for VS Code & GitHub Copilot (`sulcus-vscode`)

Persistent thermodynamic memory, reactive triggers, `@sulcus` Copilot Chat Participant, and MCP server integration for **Visual Studio Code** and **GitHub Copilot Agent Mode**.

## Features
- **Native `.vscode/mcp.json`**: Supports both local `sulcus stdio` and zero-install Cloud MCP (`https://api.sulcus.ca/mcp`) with proactive `<sulcus-peers>` signal piggybacking on every MCP tool call.
- **`@sulcus` Chat Participant**: Query project memories and inspect active peer `intent.overlap` / `territory.conflict` alerts directly from GitHub Copilot Chat.
- **Editor Save Heartbeats & Turn Ingestion**: Automatically publishes active file territories to `/api/v1/agent/bus/heartbeat` and ingests selections via `/api/v1/agent/ingest`.
