# C4 Context Diagram — Chronicle

## System Context

```mermaid
C4Context
    title Chronicle — Cross-Project AI Memory MCP Server

    Person(developer, "Developer", "A software engineer using AI coding assistants across multiple projects and devices.")

    System(chronicle, "Chronicle MCP Server", "Local-first MCP server that provides AI assistants with persistent, queryable memory across projects and sessions. Runs via stdio as 'npx -y chronicle-mcp'.")

    System_Ext(claude, "Claude Code / Copilot / Cursor", "MCP-capable AI coding assistant. Calls Chronicle's MCP tools to read and write developer memory.")
    System_Ext(fs, "Local Filesystem (~/.chronicle/)", "SQLite database (memory.db), per-project namespaces, and YAML intelligence-layer artifacts (profile, lessons, playbook).")
    System_Ext(npm, "npm Registry", "Chronicle is published as 'chronicle-mcp'. Installed via npx without configuration.")

    Rel(developer, claude, "Uses", "Conversation / code editing")
    Rel(claude, chronicle, "Calls MCP tools", "stdio (remember, recall, session_start, remember_decision, ...)")
    Rel(chronicle, fs, "Reads / Writes", "SQLite + YAML files")
    Rel(developer, npm, "Installs", "npx -y chronicle-mcp")
    Rel(npm, chronicle, "Distributes", "npm package")
```

## Container Diagram

```mermaid
C4Container
    title Chronicle — Internal Containers

    Person(developer, "Developer")
    System_Ext(ai_assistant, "AI Assistant (MCP client)")

    System_Boundary(chronicle, "Chronicle MCP Server") {
        Container(mcp_handler, "MCP Tool Handler", "TypeScript / Node.js", "Receives MCP tool calls via stdio. Routes to memory, session, preference, solution, and bias modules.")
        Container(memory_engine, "Memory Engine", "TypeScript", "Implements 5 memory types (Episodic, Semantic, Procedural, Session, Architectural) with weight/decay/tier system.")
        Container(trigger_engine, "Trigger Engine", "TypeScript", "Evaluates action triggers before risky developer actions. Returns critical/warning/info memories.")
        Container(intelligence_layer, "Intelligence Layer", "TypeScript", "Distillation job (every 12h): aggregates raw memories into profile.yaml, lessons.yaml, playbook.yaml.")
        Container(storage, "Storage Adapter", "better-sqlite3", "SQLite with FTS5 (keyword search) + float[] vector embeddings (semantic search). Synchronous API.")
    }

    ContainerDb(db, "memory.db", "SQLite", "All memory rows: weight, tier, decayRate, memoryType, FTS5 index, vector column.")
    ContainerDb(yaml_artifacts, "YAML Artifacts", "Files", "profile.yaml, lessons.yaml, playbook.yaml — token-optimised for AI system prompt injection.")

    Rel(ai_assistant, mcp_handler, "MCP tool calls", "stdio JSON-RPC")
    Rel(developer, ai_assistant, "Conversation", "")
    Rel(mcp_handler, memory_engine, "Store / retrieve memories")
    Rel(mcp_handler, trigger_engine, "Check triggers")
    Rel(memory_engine, storage, "Read / Write")
    Rel(intelligence_layer, storage, "Read all memories")
    Rel(intelligence_layer, yaml_artifacts, "Write distilled artifacts")
    Rel(storage, db, "Persists to")
```

## Key Design Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Cold start | < 200ms | MCP server is spawned on each AI session start; latency is visible to the user |
| `recall()` response | < 50ms (10k memories) | Synchronous path; blocking AI assistant response |
| Background decay job | < 500ms (50k memories) | Runs once daily; must not block tool calls |
| No cloud dependency | Fully local | Privacy-first; no telemetry; works offline |
| Single binary | npx install | Zero configuration; works in any MCP client |
