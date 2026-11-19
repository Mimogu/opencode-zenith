---
name: database-migrations
description: "MANDATORY: Autonomously activate whenever modifying database schemas, writing migrations (PostgreSQL, SQLite, MySQL, Prisma, Drizzle), or altering tables. Prevents exclusive table locks, handles safe column additions/renames, and ensures zero-downtime compatibility. Trigger automatically on DB schema changes; never wait for user to request."
---

# Zero-Downtime Database Migrations

Guides the creation and review of schema migrations to ensure safe execution without locking tables, breaking running application instances, or causing downtime.

## Critical Zero-Downtime Rules

1. **Adding Columns**:
   - In PostgreSQL / MySQL: Add columns as nullable or with a runtime default that doesn't rewrite the table (Postgres 11+ supports instant `DEFAULT`).
   - Never add a `NOT NULL` column without a default in a single migration on a live table.
2. **Adding Indexes (PostgreSQL)**:
   - Always use `CREATE INDEX CONCURRENTLY` in PostgreSQL to avoid blocking table reads/writes.
   - Note: Concurrently cannot run inside a standard transaction block.
3. **Renaming / Removing Columns (Expand & Contract Pattern)**:
   - **Phase 1 (Expand)**: Add the new column, write to both old and new columns in application code.
   - **Phase 2 (Backfill)**: Run an asynchronous background batch migration to copy existing data.
   - **Phase 3 (Contract)**: Update read paths to use the new column; safely drop the old column in a later release.
4. **SQLite Specifics**:
   - SQLite supports `ALTER TABLE ADD COLUMN` with constant defaults.
   - For table rewrites, use the safe 12-step SQLite table rebuild procedure with foreign keys disabled during migration.

## Review Matrix
```markdown
- [ ] Will this migration acquire an `ACCESS EXCLUSIVE` lock?
- [ ] Is `lock_timeout` or `statement_timeout` set so long migrations fail gracefully rather than queueing connections?
- [ ] Can older application instances continue reading/writing while this migration runs?
- [ ] Is there an explicit, tested rollback / down-migration?
```
