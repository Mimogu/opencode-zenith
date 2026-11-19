---
name: schema-to-type
description: "MANDATORY: Autonomously activate whenever handling API responses, JSON payloads, curl output, or SQL schema definitions. Generates strict, idiomatic TypeScript interfaces, type definitions, and runtime Zod schemas. Trigger automatically on raw data or schema modeling tasks; never wait for user to request."
---

# Schema-to-Type & Zod Generator

Converts raw API payloads, database models, and dynamic structures into strict, zero-`any` TypeScript types and runtime Zod validation schemas.

## Workflow

1. **Ingest Payload**: Inspect the raw JSON, curl output, or database table schema.
2. **Infer Nullability & Optionality**:
   - Fields that are absent in some payloads -> optional (`field?: type` / `z.optional()`).
   - Fields that can be null -> nullable (`field: type | null` / `z.nullable()`).
3. **Recursive Type Generation**:
   - Extract nested objects into standalone, well-named interfaces.
   - Extract repeated string unions into typed string literal unions or enums.
4. **Co-locate Zod Schema**:
   - Pair every interface with an exportable Zod parser: `export const MySchema = z.object({ ... });`
   - Derive the TypeScript type directly: `export type MyType = z.infer<typeof MySchema>;`

## Example Pattern

```typescript
import { z } from "zod";

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(30),
  email: z.string().email(),
  role: z.enum(["admin", "member", "guest"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;
```

## Best Practices
- Never emit `any`. Use `unknown` or narrow with disciminated unions.
- Preserve exact casing from raw payloads (use `.transform()` or `.passthrough()` if needed).
