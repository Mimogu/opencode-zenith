---
description: Navigate and operate the Graphify knowledge graph for the current project. Provides access to graph extraction, querying, pathfinding, clustering, and export commands via the graphify CLI.
---

# /graphify

Use this command to interact with the Graphify knowledge graph. It wraps the `graphify` CLI and exposes its subcommands for graph management, querying, and analysis.

## Usage

```text
/graphify
/graphify extract <path>
/graphify query "<question>"
/graphify path "A" "B"
/graphify explain "X"
/graphify god-nodes
/graphify cluster-only <path>
/graphify label <path>
/graphify export html
/graphify export callflow-html
/graphify export obsidian
/graphify export wiki
/graphify export svg
/graphify export graphml
/graphify hook install
/graphify hook status
/graphify install --platform opencode
/graphify uninstall
/graphify provider list
```

## Operating Rules

1. Run commands via the `graphify` CLI installed in the project environment (`uv run graphify ...`).
2. Default graph location is `graphify-out/graph.json` relative to the workspace root.
3. For extraction commands, ensure API keys are configured for the selected backend (Gemini, OpenAI, etc.).
4. Prefer `query` and `explain` for ad-hoc architectural questions; use `extract` for full rebuilds.

## Subcommand Reference

### Extraction & Update
- `extract <path>` — Full AST + semantic extraction (requires LLM backend)
- `update <path>` — Re-extract code files only (no LLM)
- `watch <path>` — Watch folder and rebuild on changes
- `add <url>` — Fetch URL content and update graph

### Query & Analysis
- `query "<question>"` — BFS traversal for a question
- `path "A" "B"` — Shortest path between two nodes
- `explain "X"` — Plain-language explanation of a node and neighbors
- `god-nodes` — List most connected architectural hubs
- `affected "X"` — Reverse traversal to find impacted nodes
- `diagnose multigraph` — Report edge collapse risk

### Clustering & Labeling
- `cluster-only <path>` — Rerun clustering on existing graph
- `label <path>` — (Re)name communities with LLM backend

### Export
- `export html` — Interactive graph.html
- `export callflow-html` — Mermaid-based call-flow HTML
- `export obsidian` — Obsidian vault notes + canvas
- `export wiki` — Wiki markdown articles
- `export svg` — Graph SVG
- `export graphml` — GraphML format
- `export neo4j` — Cypher or push to Neo4j
- `export falkordb` — Cypher or push to FalkorDB

### Hooks & Platform Integration
- `hook install` — Install git hooks (post-commit/post-checkout)
- `hook status` — Check if hooks are installed
- `install --platform <name>` — Copy skill to platform config (opencode, claude, cursor, etc.)
- `uninstall` — Remove graphify from all platforms

### Provider Management
- `provider list` — List custom LLM providers
- `provider show <name>` — Show provider details
- `provider add <name>` — Add custom provider
- `provider remove <name>` — Remove custom provider

## Common Workflows

### Initial Extraction
```text
/graphify extract .
```

### Architectural Question
```text
/graphify query "How does authentication flow through the API layer?"
```

### Find Dependencies
```text
/graphify path "UserService" "DatabaseConnection"
```

### Visualize Architecture
```text
/graphify export html
/graphify export callflow-html
```

### Set Up Git Hooks
```text
/graphify hook install
```

## Related Commands

- `/graphify install --platform opencode` — Register Graphify skill in OpenCode
- `/graphify uninstall` — Remove Graphify from all platforms