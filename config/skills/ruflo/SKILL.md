---
name: ruflo
description: "MANDATORY: Autonomously activate via bash CLI whenever a task requires multi-agent swarm orchestration, RuVector vector memory recall, neural pattern learning, or consensus coordination. Trigger automatically when single-agent context is insufficient or vector recall is needed; never wait for user to request."
---

# Ruflo Swarm & Vector Memory Orchestration

The `ruflo` CLI provides production multi-agent orchestration, vector memory, neural pattern learning, and swarm coordination directly via shell commands. Use this skill whenever a task exceeds single-agent capacity or requires persistent vector recall.

## When to Use Ruflo Automatically

- **Multi-Agent Swarm Tasks**: Complex feature builds or multi-repository refactors that benefit from parallel specialist agents (coder, architect, tester, reviewer).
- **RuVector / Semantic Recall**: Searching long-term knowledge, architecture patterns, or past solutions using semantic similarity.
- **Hive-Mind / Consensus**: High-risk architectural decisions requiring multi-perspective validation and voting.
- **Persistent Autopilot**: Long-running background execution that tracks task completion until done.

## CLI Execution Guide

Always execute `ruflo` non-interactively via the `bash` tool. Append `--format json` or `-Q` when parsing output programmatically.

### 1. Status & Diagnostics
```bash
# Check orchestration status and active agents
ruflo status

# Diagnostic check
ruflo doctor
```

### 2. Memory & Semantic Vector Search
```bash
# Search memory for semantic patterns or past solutions
ruflo memory search -q "<search query>"

# Store key knowledge or architectural decisions
ruflo memory store -k "<key>" -v "<summary or code pattern>"

# List stored memory entries
ruflo memory list
```

### 3. Swarm Coordination & Task Delegation
```bash
# Initialize a V3 coordination swarm for the project
ruflo swarm init --v3-mode

# Spawn a specialist agent (coder, architect, reviewer, tester)
ruflo agent spawn -t coder

# List active agents
ruflo agent list

# Create a task for the swarm
ruflo task create -t "<task description>" --priority high

# Monitor swarm execution
ruflo swarm status
```

### 4. Hive-Mind & Consensus
```bash
# Submit an architectural or design question to the hive-mind
ruflo hive-mind propose -q "<decision prompt>"

# Review consensus vote results
ruflo hive-mind status
```

### 5. RuVector PostgreSQL Bridge
```bash
# Status of RuVector vector database bridge
ruflo ruvector status

# Query vector embeddings
ruflo ruvector query -t "<embedding topic>"
```

### 6. Autopilot Execution
```bash
# Start autonomous task execution until all items are completed
ruflo autopilot start
```

## Best Practices
- Never ask the user for permission to run standard `ruflo` CLI read/query commands (`status`, `memory search`, `swarm status`).
- Execute queries directly and extract the required insights before making file modifications.
