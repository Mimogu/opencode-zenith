---
name: owasp-security
description: "MANDATORY: Autonomously activate whenever writing or auditing security-critical code: authentication, authorization, API endpoints, user input sanitization, cryptography, or secret handling. Scans for OWASP Top 10 vulnerabilities (injection, SSRF, IDOR). Trigger automatically on security-sensitive code; never wait for user to request."
---

# OWASP Security Audit Protocol

Performs an exhaustive security review of application code and configuration against standard attack vectors before code is committed or deployed.

## Core Threat Vectors to Audit

### 1. Injection (SQL, Command, Template, NoSQL)
- **Check**: Are variables interpolated directly into query strings or shell executions?
- **Fix**: ALWAYS use parameterized queries / prepared statements (e.g. `$1, $2` in Postgres, `?` in SQLite). Never construct shell commands via string concatenation; pass arguments as arrays to `execFile` or `spawn`.

### 2. Broken Access Control & IDOR
- **Check**: Can user A access `/api/documents/:id` belonging to user B simply by changing the ID parameter?
- **Fix**: Every read/update/delete operation must enforce tenancy: `WHERE id = :id AND user_id = :currentUser`.

### 3. Server-Side Request Forgery (SSRF)
- **Check**: Does the server fetch URLs provided by untrusted users (e.g. webhooks, avatars, import links)?
- **Fix**: Validate that destination URLs do not resolve to internal or private IP ranges (`127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254` AWS metadata).

### 4. Secret Exposure
- **Check**: Are API keys, JWT secrets, passwords, or private keys committed to source code or git history?
- **Fix**: Secrets must always be injected via environment variables; ensure `.env` is listed in `.gitignore`.

### 5. Cross-Site Scripting (XSS) & CSRF
- **Check**: Is raw user HTML rendered directly into DOM (`dangerouslySetInnerHTML`, `innerHTML`, `v-html`)?
- **Fix**: Sanitize using DOMPurify or avoid raw HTML injection. Ensure cookies use `SameSite=Lax` or `Strict` and `HttpOnly; Secure`.

## Audit Command
When auditing a repository:
```bash
# Set the scope first: only the files/directories the user named ("." = whole repo)
SCOPE=(src/routes src/auth)
# JS/TS template interpolation in SQL / shell calls
git grep -nE '(exec|query|raw)\(.*\$\{.*\}' -- "${SCOPE[@]}" || true
# Python f-string, %, + or .format() in SQL / shell calls
git grep -nE "\.(execute|executemany|raw|query)\(\s*(f[\"']|.*[\"']\s*(%|\+)|.*\.format\()|os\.system\(|subprocess\..*shell\s*=\s*True" -- "${SCOPE[@]}" || true
# Hardcoded keys or tokens
git grep -niE "(api_key|secret|password|bearer|auth)\s*[:=]\s*['\"][a-zA-Z0-9_\-]{8,}['\"]" -- "${SCOPE[@]}" || true
```
Grep only finds candidates: read each hit before reporting it. Outside a git repo use `grep -rnE` with the same patterns.

## Path Scope
Audit only the files/directories the user declared (the `SCOPE` above). Do not report findings outside them; mention them in one line at most.

## Triage Gate (every finding must pass)
Every reported finding MUST include all four, otherwise it is **downgraded** (not reported):
1. `file:line` evidence (exact location from grep/scan)
2. Concrete exploit path (how an attacker would trigger it)
3. Severity: CRITICAL / HIGH / MEDIUM / LOW (with justification)
4. Fix (specific code change or pattern to apply)

No finding is reported without all four. This replaces "exploit further to prove it" with a documentation gate.
