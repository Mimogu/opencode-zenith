---
name: production-hardening
description: |
  Unified production hardening skill for security, errors, accessibility, and metadata.
  Sub-commands: security, errors, accessibility, metadata.
  Use when hardening code for production: security review, error handling, accessibility fixes, metadata/SEO.
---
# Production Hardening

Unified production hardening skill combining: **security**, **errors**, **accessibility**, **metadata**.

## Sub-Commands

| Command | Description |
|---------|-------------|
| `harden security` | Comprehensive security review: secrets, input validation, SQL injection, auth, XSS, CSRF, rate limiting, sensitive data, dependencies |
| `harden errors` | Error handling patterns: typed errors, result pattern, API handlers, React boundaries, retries, user-facing messages |
| `harden accessibility` | WCAG compliance audit: accessible names, keyboard access, focus management, semantics, forms, contrast, media |
| `harden metadata` | SEO/social metadata audit: titles, descriptions, canonical, Open Graph, Twitter cards, favicons, JSON-LD |

---

## harden security — Comprehensive Security Review

### When to Activate
- Implementing authentication/authorization
- Handling user input or file uploads
- Creating API endpoints
- Working with secrets/credentials
- Payment/sensitive features
- Third-party API integration

### Checklist Categories

#### 1. Secrets Management
**FAIL:** Hardcoded API keys, tokens, passwords in source
**PASS:** All secrets in env vars, `.env.local` in `.gitignore`, no secrets in git history, production secrets in hosting platform

#### 2. Input Validation
**Always validate with schemas (zod):**
```typescript
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150)
})
```
**File uploads:** size limits, type whitelist, extension check

#### 3. SQL Injection Prevention
**FAIL:** String concatenation in SQL
**PASS:** Parameterized queries / ORM / query builder
```typescript
// Safe
await db.query('SELECT * FROM users WHERE email = ?', [userEmail])
```

#### 4. Authentication & Authorization
- JWT in httpOnly cookies (not localStorage)
- Authorization checks BEFORE sensitive operations
- Row Level Security (Supabase) enabled on all tables
- Role-based access control implemented

#### 5. XSS Prevention
- Sanitize user HTML with DOMPurify
- CSP headers: start strict, loosen only with documented plan
- No `'unsafe-inline'` or `'unsafe-eval'` without documented removal plan

#### 6. CSRF Protection
- CSRF tokens on state-changing operations
- `SameSite=Strict` on all cookies
- Double-submit cookie pattern

#### 7. Rate Limiting
- API: 100 req/15min default
- Expensive ops (search): 10 req/min
- IP-based + user-based (authenticated)

#### 8. Sensitive Data Exposure
- No passwords/tokens in logs
- Generic error messages for users, detailed in server logs only
- No stack traces exposed to users

#### 9. Dependency Security
- `npm audit` / `npm audit fix` / `npm update` regularly
- Lock files committed (`package-lock.json`)
- `npm ci` in CI/CD
- Dependabot enabled

---

## harden errors — Error Handling Patterns

### Core Principles
1. Fail fast and loudly at boundary
2. Typed errors over string messages
3. User messages ≠ developer messages
4. Never swallow errors silently
5. Errors are part of API contract

### TypeScript: Typed Error Classes
```typescript
export class AppError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode: number = 500, public readonly details?: unknown) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) { super(`${resource} not found: ${id}`, 'NOT_FOUND', 404) }
}
export class ValidationError extends AppError {
  constructor(message: string, details: { field: string; message: string }[]) { super(message, 'VALIDATION_ERROR', 422, details) }
}
export class UnauthorizedError extends AppError { constructor(reason = 'Authentication required') { super(reason, 'UNAUTHORIZED', 401) } }
export class RateLimitError extends AppError { constructor(public readonly retryAfterMs: number) { super('Rate limit exceeded', 'RATE_LIMITED', 429) } }
```

### Result Pattern (No-Throw)
```typescript
type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E }

async function fetchUser(id: string): Promise<Result<User>> {
  try {
    const user = await db.users.findUnique({ where: { id } })
    if (!user) return { ok: false, error: new NotFoundError('User', id) }
    return { ok: true, value: user }
  } catch (e) { return { ok: false, error: new AppError('Database error', 'DB_ERROR') } }
}
```

### API Error Handler (Next.js/Express)
```typescript
function handleApiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, { status: error.statusCode })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) } }, { status: 422 })
  }
  console.error('Unexpected error:', error)
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, { status: 500 })
}
```

### React Error Boundary
```typescript
export class ErrorBoundary extends Component<{ fallback: ReactNode; onError?: (error: Error, info: ErrorInfo) => void }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error } }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError?.(error, info); console.error('Unhandled React error:', error, info) }
  render() { if (this.state.hasError) return this.props.fallback; return this.props.children }
}
```

### Retry with Exponential Backoff
```typescript
async function withRetry<T>(fn: () => Promise<T>, { maxAttempts = 3, baseDelayMs = 500, maxDelayMs = 10_000, retryIf = () => true } = {}): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn() } catch (error) {
      lastError = error
      if (attempt === maxAttempts || !retryIf(error)) throw error
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs, maxDelayMs)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}
// Usage: retry transient network errors, not 4xx
await withRetry(() => fetch('/api/data').then(r => r.json()), { retryIf: e => !(e instanceof AppError && e.statusCode < 500) })
```

### User-Facing Messages
```typescript
const USER_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'The requested item could not be found.',
  UNAUTHORIZED: 'Please sign in to continue.',
  FORBIDDEN: "You don't have permission to do that.",
  VALIDATION_ERROR: 'Please check your input and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again later.',
}
export function getUserMessage(code: string) { return USER_ERROR_MESSAGES[code] ?? USER_ERROR_MESSAGES.INTERNAL_ERROR }
```

### Checklist
- [ ] Every `catch` handles, re-throws, or logs — no silent swallowing
- [ ] API errors: `{ error: { code, message } }` envelope
- [ ] User messages: no stack traces/internal details
- [ ] Full context logged server-side
- [ ] Custom errors extend `AppError` with `code` field
- [ ] Async functions surface errors — no fire-and-forget
- [ ] Retry only retriable errors (not 4xx)
- [ ] React components wrapped in `ErrorBoundary`

---

## harden accessibility — WCAG Compliance Audit

### Priority Order
1. **Accessible names** (critical)
2. **Keyboard access** (critical)
3. **Focus & dialogs** (critical)
4. **Semantics** (high)
5. **Forms & errors** (high)
6. **Announcements** (medium-high)
7. **Contrast & states** (medium)
8. **Media & motion** (low-medium)
9. **Tool boundaries** (critical)

### Quick Reference

#### 1. Accessible Names
- Every interactive control has accessible name
- Icon-only buttons: `aria-label` or `aria-labelledby`
- Every input/select/textarea labeled
- Links: meaningful text (no "click here")
- Decorative icons: `aria-hidden="true"`

#### 2. Keyboard Access
- No `div`/`span` as buttons without full keyboard support
- All interactive elements reachable by Tab
- Focus visible for keyboard users
- No `tabindex > 0`
- Escape closes dialogs/overlays

#### 3. Focus & Dialogs
- Modals trap focus while open
- Restore focus to trigger on close
- Set initial focus inside dialogs
- No unexpected scroll on dialog open

#### 4. Semantics
- Native elements (`button`, `a`, `input`) over role-based hacks
- Role used → required ARIA attributes present
- Lists: `ul`/`ol` with `li`
- No skipped heading levels
- Tables: `th` for headers

#### 5. Forms & Errors
- Errors linked via `aria-describedby`
- Required fields announced
- Invalid fields: `aria-invalid="true"`
- Helper text associated with inputs
- Disabled submit explains why

#### 6. Announcements
- Critical errors: `aria-live`
- Loading: `aria-busy` or status text
- Toasts not only way for critical info
- Expandable: `aria-expanded` + `aria-controls`

#### 7. Contrast & States
- Sufficient contrast for text/icons
- Hover-only interactions have keyboard equivalents
- Disabled states not color-only
- Focus outlines not removed without visible replacement

#### 8. Media & Motion
- Images: meaningful `alt` or empty `alt=""`
- Videos with speech: captions
- Respect `prefers-reduced-motion`
- No autoplay with sound

#### 9. Tool Boundaries
- Minimal changes, no unrelated refactoring
- No ARIA when native semantics solve it
- No UI library migration unless requested

### Common Fixes
```html
<!-- Icon-only button -->
<button aria-label="Close"><svg aria-hidden="true">...</svg></button>

<!-- Div as button → native -->
<button onclick="save()">Save</button>

<!-- Form error linked -->
<input id="email" aria-describedby="email-err" aria-invalid="true" />
<span id="email-err">Invalid email</span>
```

---

## harden metadata — SEO/Social Metadata Audit

### Priority Order
1. **Correctness & duplication** (critical)
2. **Title & description** (high)
3. **Canonical & indexing** (high)
4. **Social cards** (high)
5. **Icons & manifest** (medium)
6. **Structured data** (medium)
7. **Locale & alternates** (low-medium)
8. **Tool boundaries** (critical)

### Rules

#### 1. Correctness & Duplication
- Single metadata source per page (no competing systems)
- No duplicate `title`, `description`, `canonical`, `robots`
- Deterministic values (no random/unstable)
- Escape/sanitize user-generated strings
- Safe defaults for title/description on every page

#### 2. Title & Description
- Every page has title
- Consistent format across site
- Short, readable, no keyword stuffing
- Shareable/searchable pages have meta description
- Plain text only (no markdown/quote spam)

#### 3. Canonical & Indexing
- Canonical = preferred URL
- `noindex` only for private/duplicate/non-public
- `robots` meta matches actual access intent
- Previews/staging: `noindex` by default
- Paginated pages: correct canonical behavior

#### 3. Social Cards
- Shareable pages: OG title, description, image
- OG/Twitter images: absolute URLs
- Correct dimensions/aspect ratios
- `og:url` matches canonical
- Sensible `og:type` (`website`/`article`)
- `twitter:card` = `summary_large_image` default

#### 5. Icons & Manifest
- At least one cross-browser favicon
- `apple-touch-icon` when relevant
- Valid manifest, referenced
- Intentional `theme-color`
- Stable, cacheable icon paths

#### 6. Structured Data (JSON-LD)
- Only when maps to real page content
- Valid, reflects rendered content
- No invented ratings/reviews/prices/org details
- One block per page unless required

#### 7. Locale & Alternates
- Correct `html lang`
- `og:locale` when localized
- `hreflang` only when pages truly exist
- Localized pages canonicalize correctly per locale

#### 8. Tool Boundaries
- Minimal changes, no unrelated refactoring
- No framework/SEO library migration unless requested
- Follow project's existing pattern (Next.js metadata API, react-helmet, manual head)

### Review Order
1. Fix critical: duplicates, canonical, indexing
2. Ensure title, description, canonical, `og:url` agree
3. Verify social cards on real URL (not localhost)
3. Stable, boring metadata over clever/dynamic
4. Keep diffs minimal, scoped to metadata only

---

## Quick Reference

| Task | Command |
|------|---------|
| Security audit | `harden security` |
| Error handling review | `harden errors` |
| Accessibility audit | `harden accessibility <file>` |
| Metadata/SEO audit | `harden metadata` |