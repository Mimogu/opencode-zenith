# Connectors

## How Tool References Work

OpenCode data skill files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~data warehouse` might mean Snowflake, BigQuery, or any other warehouse with an MCP server.

These skills are **tool-agnostic** — they describe workflows in terms of categories (data warehouse, notebook, product analytics, etc.) rather than specific products. Any configured MCP server in that category works.

## Connectors for Data Skills

| Category | Placeholder | Included Servers | Other Supported Options |
|---|---|---|---|
| Data warehouse | `~~data warehouse` | BigQuery, Definite | Snowflake, Redshift, PostgreSQL, MySQL, ClickHouse |
| Notebook | `~~notebook` | Hex | Jupyter, Deepnote, Observable |
| Product analytics | `~~product analytics` | Amplitude | Mixpanel, Heap, PostHog |
| Project tracker | `~~project tracker` | Atlassian (Jira/Confluence) | Linear, Asana, GitHub Issues |
