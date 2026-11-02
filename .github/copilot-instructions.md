# Sulcus Persistent Memory & Peer Event Bus Instructions (VS Code / GitHub Copilot)

You have access to the **Sulcus** thermodynamic memory engine via MCP.

1. **Recall Before Implementing**:
   - Call `build_context` or `search_memory` when starting a task or switching topics to surface architectural decisions (`semantic`), user preferences (`preference`), and verified workflows (`procedural`).
2. **Respect Proactive Peer Bus Signals (`<sulcus-peers>`)**:
   - Sulcus automatically appends `<sulcus-peers>` blocks to MCP tool responses whenever a reactive trigger fires (`trigger.notify`), a peer agent edits the same files (`territory.conflict`), works on a semantically similar task (`intent.overlap`), or broadcasts `milestone.reached` / `solution.discovered`. Use `manage_namespace_connections` to self-govern connected namespaces within your ACL.
3. **Store High-Signal Decisions**:
   - Use `store_memory` to persist architectural decisions, root-cause fixes, and user preferences in clean plain text (never raw markdown headers or code blocks).
