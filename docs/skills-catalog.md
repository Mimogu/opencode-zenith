# OpenCode Skills Catalog & Decision Guide

> [!NOTE]
> **How to Use This Guide:** If you are unsure which skill to pick inside a category (e.g. *Which review skill do I use?*), look at the **Decision Guide Table** at the top of each category. It matches your exact real-world goal directly to the best skill and gives you a copy-paste prompt.

---

## Master User Guide & Quick Reference

OpenCode is optimized for high efficiency, deterministic accuracy, and token-saving operation across both local free models (8k–32k context) and frontier cloud models.

---

### 1. Slash Commands (`/command`)

Slash commands are powerful operational modes that guide the agent through structured engineering workflows:

| Slash Command | What It Does | When to Use It / Scenario | Example Prompt |
| :--- | :--- | :--- | :--- |
| **`/plan <task>`** | **Plans Before Coding:** Deconstructs requirements, identifies architectural risks, breaks work into phases, and **waits for your confirmation** before modifying any code. | Use before starting any major feature, multi-file refactor, or complex change. | `/plan build a REST API endpoint for user profile pictures` |
| **`/goal <task>`** | **Autonomous Objective Mode:** Runs persistently in a deep-dive execution loop. Tests, diagnoses, and iterates autonomously until the objective is objectively verified. | Use for long-running or overnight tasks where you want the agent to resolve all errors without stopping early. | `/goal fix all failing tests in the auth test suite and ensure clean build` |
| **`/loop [interval] <task>`** | **Recurring & Self-Paced Loop:** Runs a prompt on a repeating interval (e.g. `/loop 30m <task>`) or in an autonomous continuous execution loop until stopped via `/stop`. | Use for periodic health checks, recurring scans, or tasks requiring continuous unattended execution without yielding. | `/loop 30m check system health and record to scan-report.md` |
| **`/stop`** | **Halt Active Automations:** Immediately stops any running background loop, recurring schedule, or watchdog timer. | Use whenever you want to terminate an active `/loop` or periodic background task. | `/stop` |
| **`/grill-me <idea>`** | **Design Alignment Interview:** Interactively grills you with 3–5 sharp architectural and edge-case questions to stress-test your design decisions before coding. | Use when you have a general idea but want to clarify edge cases, trade-offs, and UX decisions first. | `/grill-me migrate our state management from Redux to Zustand` |
| **`/debug <issue>`** | **4-Phase Root-Cause Debugging:** Systematically gathers evidence, isolates the flaw, applies a surgical fix, and runs regression gates without speculative guessing. | Use whenever an error, crash, or unexpected behavior occurs in code. | `/debug why does the session token expire immediately on reload?` |
| **`/verify`** | **Verification Loop:** Executes comprehensive validation across type-checks (`tsc`), linters (`eslint`), unit tests, integration tests, and build scripts. | Use before committing, creating a pull request, or declaring work finished. | `/verify ensure all TypeScript types and unit tests pass cleanly` |
| **`/explore <topic>`** | **Codebase Reconnaissance:** Fast, read-only survey of repository structure, architecture patterns, and key entry points without modifying files. | Use when orienting yourself in a new repository or unfamiliar module. | `/explore find where user permissions are checked in the backend` |
| **`/code-review [diff]`** | **Deep Quality & Security Audit:** Thoroughly inspects branches or diffs for security holes (OWASP), performance bottlenecks, and code smell. | Use before merging PRs or deploying code to production. | `/code-review audit the changes between main and feature/payments` |
| **`/review-pr <pr#\|branch>`** | **Multi-Perspective PR Review:** Spawns specialized reviewers (`code-reviewer`, `comment-analyzer`, `pr-tester`) to audit pull requests. | Use to review external pull requests or cross-branch diffs thoroughly. | `/review-pr 42` |
| **`/security-scan`** | **Vulnerability & Secret Scanner:** Runs AgentShield against agent, hook, MCP, permission, and secret attack surfaces. | Use to scan repositories for leaked API keys, unsafe file permissions, or command injection risks. | `/security-scan scan config and scripts for leaked credentials` |
| **`/build-fix`** | **Surgical Compiler & Build Resolver:** Fixes TypeScript errors, missing dependencies, and build failures with minimal code churn. | Use when `npm run build`, `tsc`, or `cargo check` fails with syntax or type errors. | `/build-fix resolve all missing import and type errors in src/` |
| **`/refactor-clean`** | **Dead Code & Duplication Cleaner:** Safely eliminates obsolete functions, unused variables, and duplicates without breaking public APIs. | Use to clean up technical debt and reduce codebase surface area after major features. | `/refactor-clean remove deprecated auth handlers in src/auth` |
| **`/tdd <spec>`** | **Test-Driven Development Loop:** Strictly writes failing unit tests first, implements minimal passing code, and refactors cleanly (aiming for 80%+ coverage). | Use when authoring new business logic, algorithms, or utility libraries. | `/tdd implement a token bucket rate limiter with sliding window` |
| **`/test-coverage`** | **Test Gap Analysis:** Analyzes untested branches and generates edge-case unit and integration tests. | Use when test coverage is low or critical edge cases need automated regression tests. | `/test-coverage generate missing unit tests for payment webhook handlers` |
| **`/feature-dev <spec>`** | **Guided Feature Development:** Structured end-to-end workflow covering architecture design, phased coding, and verification. | Use for implementing large features that span multiple modules or database tables. | `/feature-dev add OAuth2 Google login flow with session cookies` |
| **`/graphify [args]`** | **On-Demand Knowledge Graph Engine:** Extracts AST knowledge graphs and runs queries, path traces, and node explanations across repositories. | Use when exploring large codebases to trace call hierarchies or dependency hubs. | `/graphify query "How does request routing reach the database?"` |
| **`/aside <question>`** | **Side-Question Scratchpad:** Answers a quick tangential question without interrupting or losing context from your active main task. | Use when you want to ask a quick syntax or API question without derailing an ongoing plan. | `/aside what is the difference between Array.slice and Array.splice in JS?` |
| **`/scratch [lang]`** | **Isolated Prototyping Script:** Creates and runs a sandboxed scratch script to safely test an API, library, or reproduction snippet. | Use to test an unfamiliar third-party library or reproduce a minimal bug isolate. | `/scratch python test whether urllib.request honors http_proxy env` |
| **`/checkpoint [msg]`** | **Verification Checkpoint:** Saves git snapshot and verification state so you can safely experiment and rollback if needed. | Use before running risky refactors or database migrations. | `/checkpoint before migrating database schema` |
| **`/status`** | **System & Model Health Dashboard:** Displays live benchmark scores, active model ladders, router health, and API quota states. | Use to check current model rankings, latency, and provider availability. | `/status` |
| **`/lab [mode]`** | **Model Benchmark Harness:** Runs live capability tests against free provider models and recalibrates local routing ladders. | Use to test which free models are currently fastest and most reliable. | `/lab daily` |
| **`/eval [criteria]`** | **Acceptance Criteria Evaluator:** Tests implementation against formal test matrices and acceptance criteria. | Use before shipping releases to verify compliance with product requirements. | `/eval check if all endpoints return RFC 7807 error responses` |
| **`/skill-create <name>`** | **Custom Skill Scaffolder:** Generates structured OpenCode skills with YAML frontmatter from repository workflows or git history. | Use when you want to bundle repeatable developer workflows into a reusable skill. | `/skill-create deploy-preview` |
| **`/update-docs`** | **Documentation Synchronizer:** Automatically inspects recent codebase changes and synchronizes `README.md` and API documentation. | Use after major pull requests or breaking API changes. | `/update-docs synchronize README with new CLI flags` |
| **`/image <prompt>`** | **AI Image Generation:** Formulates optimized prompts and routes them through free image backends (OVH, Pollinations, HuggingFace). | Use to generate UI mockups, icons, banners, or generative game textures. | `/image minimalist dark mode app icon for a database tool` |
| **`/video <prompt>`** | **Programmatic Video Clip Generation:** Directs and synthesizes short video sequences via free generative video endpoints. | Use to render quick animation loops or preview clips. | `/video rotating 3D wireframe cube with neon lighting` |

---

### 2. Review Control & The `#noreview` Tag

OpenCode includes an automated reviewer (`verify-claims`) designed to keep free and low-context models honest by preventing them from hallucinating that a task was completed when no changes were made on disk.

#### When to Use `#noreview`:
For **interactive, visual, or ephemeral tasks** (such as watching a video in a browser, checking website layout, testing audio, or asking quick questions), you are already watching the screen and know whether it worked. The automated reviewer does not need to run background log audits or order duplicate re-runs.

* Simply append **`#noreview`** anywhere in your prompt:
  ```text
  remote control brave to play this video for 30 seconds #noreview
  open localhost:3000 in firefox and inspect the navigation bar #noreview
  quick check of the api response status #noreview
  ```
* **Result**: OpenCode executes your task, outputs the answer, and cleanly stops on **Attempt 1** without any background reviewer delays or repeated loops.
* **When to leave `#noreview` OFF**: For serious code editing, bug fixes, or system configuration, omit `#noreview` so the reviewer can automatically catch missed file edits or broken tests.

---

### 3. Browser Remote Control Guide

OpenCode provides dynamic browser capabilities split into two distinct modes:

#### A. Desktop Remote Control (Real User Browser)
When you want OpenCode to visually interact with your installed desktop browser (Brave, Chrome, Chromium, Firefox, Helium, etc.):
* **Trigger Prompt**: Write *"remote control <browser-name> ..."*:
  ```text
  remote control brave to search youtube for miku dayo and play the first result #noreview
  remote control chrome to open github.com/trending and list the top 3 repos #noreview
  ```
* **How It Works**: OpenCode dynamically boots the browser with its automation port (`browser-ctl start <browser>`), controls real tabs via MCP tools, and cleanly closes the desktop app when finished (`browser-ctl stop <browser>`).

#### B. Autonomous Internet Browsing & Search (Background Mode)
When you want OpenCode to quietly browse documentation, search for bug fixes, or gather web information in the background without opening windows on your desktop:
* **Trigger Prompt**: Write *"search the web..."* or *"find docs on..."*:
  ```text
  search the web to find how to configure systemd user services on Arch Linux
  search the documentation for Bun v1.4 test runner flags
  ```
* **How It Works**: OpenCode routes these requests to **Exa websearch** or **Context7** tools, completely leaving your desktop undisturbed.

---

### 4. How to Invoke Any Skill in OpenCode

OpenCode runs in **Manual On-Demand Invocation Mode**. This ensures that skill prompts do not consume valuable token budget until you explicitly ask for them.

1. **Direct Invocation:** Simply mention the skill using `@<skill-name>`:
   ```text
   @docx create a summary report from notes.txt
   @code-review review my branch diff
   @systematic-debugging find why the login fails
   @web-research search for the latest release notes of Astro 5.0
   ```
2. **Combining Slash Commands & Skills:**
   ```text
   /plan @docx create an executive financial report
   /goal @ponytail simplify and refactor our auth middleware
   ```

---

## Quick Category Index

1. [Document, Office & Content Creation](#document-office-content-creation) *(6 skills)* — Tools for generating, editing, and converting Word, PowerPoint, Excel, PDF, and Markdown files.
2. [Web, Frontend & UI/UX Design](#web-frontend-ui-ux-design) *(7 skills)* — Tools and design standards for modern HTML/CSS, UI polish, design systems, and web widgets.
3. [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) *(10 skills)* — Engineering principles, minimalist architectures, TypeScript practices, and code cleaners.
4. [Testing, Verification & Debugging](#testing-verification-debugging) *(6 skills)* — Root-cause debugging, test suites, benchmarks, and pre-completion proof enforcers.
5. [Code Review, Auditing & Security](#code-review-auditing-security) *(7 skills)* — Deep branch audits, OWASP security checks, impact analysis, and critical objective reviews.
6. [Git, DevOps, Containers & Deployment](#git-devops-containers-deployment) *(7 skills)* — Git workflows, merge conflict resolutions, Docker optimization, and CI/CD pipelines.
7. [Database, Backend & Cloud](#database-backend-cloud) *(4 skills)* — Safe migrations, high-performance SQL, query tuning, and Supabase integrations.
8. [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) *(12 skills)* — Exploratory data analysis, statistics, A/B testing, dashboards, machine learning, and plotting.
9. [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) *(8 skills)* — Web queries, deep research dossiers, academic paper pipelines, and photo geolocation.
10. [Autonomous Multi-Agent & Orchestration](#autonomous-multi-agent-orchestration) *(7 skills)* — Lifecycle planning, subagent task execution, prompt sharpening, and structured ideation.
11. [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) *(7 skills)* — AI image/video generation, programmatic film direction, Godot 4, generative art, and 3D voxels.
12. [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) *(9 skills)* — Linux desktop control, browser automation, knowledge graphs, MCP builders, and memory tools.

---

<a id="document-office-content-creation"></a>
## 1. Document, Office & Content Creation

*Tools for generating, editing, and converting Word, PowerPoint, Excel, PDF, and Markdown files.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Need to create, edit, or format a Word document? | [`docx`](#skill-docx) | `@docx create a formatted report` |
| Need to build a PowerPoint presentation or pitch deck? | [`pptx`](#skill-pptx) | `@pptx design a 6-slide presentation` |
| Need an Excel spreadsheet with clean formulas and headers? | [`xlsx`](#skill-xlsx) | `@xlsx build a financial model` |
| Need to read, inspect, split, or merge PDF documents? | [`pdf`](#skill-pdf) | `@pdf extract tables from annual_report.pdf` |
| Need to convert ANY file (PDF, Word, PPTX, image, audio) into clean Markdown? | [`markitdown`](#skill-markitdown) | `@markitdown convert file.pdf to markdown` |
| Need to design visual graphics, posters, or certificates (PNG/PDF)? | [`canvas-design`](#skill-canvas-design) | `@canvas-design design a minimalist event poster` |

### Detailed Breakdown of Skills in Document, Office & Content Creation

<a id="skill-canvas-design"></a>
#### `canvas-design` — Visual Art & Poster Designer (PNG/PDF)
- **Source Folder:** [canvas-design](../config/skills/canvas-design)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Generates visual artwork, posters, infographics, and book covers rendered into high-resolution PNG or PDF files.
- **When to Use:** When you want visually designed certificates, posters, social media banners, or graphical cheat sheets.
- **Example Prompt:**
  ```text
  @canvas-design design a modern minimalist event poster and save as poster.png
  ```

<a id="skill-docx"></a>
#### `docx` — Word Document (.docx) Creator & Editor
- **Source Folder:** [docx](../config/skills/docx)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Creates, formats, reads, and updates Microsoft Word (.docx) documents with clean typography, styled headings, tables, callout boxes, and headers/footers.
- **When to Use:** When you need to generate professional Word reports, transform markdown notes into formatted DOCX files, or edit existing Word docs.
- **Example Prompt:**
  ```text
  @docx create a comprehensive report from these notes and export to report.docx
  ```

<a id="skill-markitdown"></a>
#### `markitdown` — Universal File to Markdown Converter
- **Source Folder:** [markitdown](../config/skills/markitdown)
- **Upstream Repository:** [microsoft/markitdown](https://github.com/microsoft/markitdown)
- **What It Does:** Converts virtually any document or media format (PDF, Word, PPTX, Excel, HTML, CSV, audio, images, ZIP) into clean, readable Markdown.
- **When to Use:** When you have non-text files and want their full contents extracted into plain text or markdown for easy editing and analysis.
- **Most Commonly Used Commands:**
  ```bash
  markitdown document.pdf                  # Convert and print Markdown to stdout
  markitdown presentation.pptx -o out.md   # Convert PPTX and save directly to Markdown file
  markitdown spreadsheet.xlsx --page 1     # Convert specific sheet of an Excel workbook
  ```
- **Example Prompt:**
  ```text
  @markitdown convert annual_report.pdf into clean markdown
  ```

<a id="skill-pdf"></a>
#### `pdf` — PDF Document Inspector & Tools
- **Source Folder:** [pdf](../config/skills/pdf)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Inspects PDF documents, extracts text and tables, merges or splits pages, fills forms, and renders visual previews of pages.
- **When to Use:** When you need to read content out of a PDF file, combine multiple PDFs, or inspect a PDF's visual layout.
- **Example Prompt:**
  ```text
  @pdf extract the text and tables from document.pdf
  ```

<a id="skill-pptx"></a>
#### `pptx` — PowerPoint Presentation (.pptx) Designer
- **Source Folder:** [pptx](../config/skills/pptx)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Designs high-quality PowerPoint slide decks (.pptx) from scratch or edits existing presentations with consistent color palettes, visual hierarchies, and modern layouts.
- **When to Use:** When you want to turn a project summary, pitch deck, or lecture into a polished PowerPoint slide presentation.
- **Example Prompt:**
  ```text
  @pptx design a 7-slide presentation summarizing our quarterly progress
  ```

<a id="skill-xlsx"></a>
#### `xlsx` — Excel Spreadsheet (.xlsx) Specialist
- **Source Folder:** [xlsx](../config/skills/xlsx)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Builds and audits Excel spreadsheets (.xlsx) with clean formulas, formatted headers, zebra striping, currency/date number formatting, and multi-sheet workbooks.
- **When to Use:** When you need to export data tables to Excel, build financial models, or check existing sheets for broken formulas.
- **Example Prompt:**
  ```text
  @xlsx build a monthly budget sheet with auto-sum formulas and formatted headers
  ```

---

<a id="web-frontend-ui-ux-design"></a>
<a id="web-frontend-ui/ux-design"></a>
## 2. Web, Frontend & UI/UX Design

*Tools and design standards for modern HTML/CSS, UI polish, design systems, and web widgets.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Writing HTML/CSS and want modern, zero-hack standards (:has, dialog, view transitions)? | [`modern-web-guidance`](#skill-modern-web-guidance) | `@modern-web-guidance style this modal dialog` |
| Building a new UI and want it to look distinctive, polished, and human-designed? | [`frontend-design`](#skill-frontend-design) | `@frontend-design design a clean landing page` |
| Auditing an existing website for accessibility (WCAG, contrast, focus) and UX flaws? | [`web-design-guidelines`](#skill-web-design-guidelines) | `@web-design-guidelines audit index.html` |
| Need a quick interactive single-file tool, calculator, or widget? | [`web-artifacts-builder`](#skill-web-artifacts-builder) | `@web-artifacts-builder build a mortgage calculator` |
| Building a 3D WebGL scene synchronized with a 2D control panel side-by-side? | [`dual-viewport-ui`](#skill-dual-viewport-ui) | `@dual-viewport-ui build a 3D model inspector` |
| UI looks ugly or messy and you want a visual critique and redesign advice? | [`design-quality`](#skill-design-quality) | `@design-quality review the checkout UI` |
| Want to inspect an existing site and extract its typography/colors into a DESIGN.md? | [`create-design-md`](#skill-create-design-md) | `@create-design-md document our design tokens` |

### Detailed Breakdown of Skills in Web, Frontend & UI/UX Design

<a id="skill-create-design-md"></a>
#### `create-design-md` — Design System Extractor (DESIGN.md)
- **Source Folder:** [create-design-md](../config/skills/create-design-md)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Inspects an existing website or code repository and generates a comprehensive DESIGN.md documenting its typography, colors, spacing, and components.
- **When to Use:** When onboarding onto a frontend project or building new pages that must strictly match the existing design tokens.
- **Example Prompt:**
  ```text
  @create-design-md inspect our frontend and write a DESIGN.md design system document
  ```

<a id="skill-design-quality"></a>
#### `design-quality` — Unified Visual Artifact & UI Quality Review
- **Source Folder:** [design-quality](../config/skills/design-quality)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Audits, critiques, and refines visual components, UI layouts, color palettes, and typography to eliminate amateurish design flaws.
- **When to Use:** When your UI feels cluttered, misaligned, or visually unappealing and needs a design review.
- **Example Prompt:**
  ```text
  @design-quality review the checkout page layout and suggest design improvements
  ```

<a id="skill-dual-viewport-ui"></a>
#### `dual-viewport-ui` — 3D + 2D Synchronized Dual-Viewport UI
- **Source Folder:** [dual-viewport-ui](../config/skills/dual-viewport-ui)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Architects synchronized dual-pane web interfaces that combine an interactive 3D WebGL scene with a reactive 2D parameter control panel.
- **When to Use:** When building 3D product visualizers, interactive maps, or CAD-like tools with side-by-side controls.
- **Example Prompt:**
  ```text
  @dual-viewport-ui create a 3D model viewer with a side property inspector panel
  ```

<a id="skill-frontend-design"></a>
#### `frontend-design` — Distinctive Frontend & UI Design
- **Source Folder:** [frontend-design](../config/skills/frontend-design)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Helps create visually distinctive, polished, and personality-driven web interfaces with cohesive color schemes, micro-interactions, and typography.
- **When to Use:** When building new web pages or apps and you want them to look premium, modern, and human-designed rather than generic AI templates.
- **Example Prompt:**
  ```text
  @frontend-design redesign the dashboard landing page with a modern dark theme
  ```

<a id="skill-modern-web-guidance"></a>
#### `modern-web-guidance` — Modern Web & CSS Standards Guide
- **Source Folder:** [modern-web-guidance](../config/skills/modern-web-guidance)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Provides cutting-edge standards for HTML, CSS, and modern browser APIs (dialogs, popovers, view transitions, container queries, :has selectors).
- **When to Use:** When building or styling websites and you want modern, accessible, zero-dependency CSS patterns rather than outdated hacks.
- **Example Prompt:**
  ```text
  @modern-web-guidance style this modal dialog using native HTML dialog and modern CSS
  ```

<a id="skill-web-artifacts-builder"></a>
#### `web-artifacts-builder` — Interactive Single-File Web Widget Builder
- **Source Folder:** [web-artifacts-builder](../config/skills/web-artifacts-builder)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Builds standalone, self-contained single-page HTML/JS applications, calculators, visualizers, and interactive prototypes that run directly in any browser.
- **When to Use:** When you need a quick, clickable web tool, interactive prototype, or simulation in a single HTML file.
- **Example Prompt:**
  ```text
  @web-artifacts-builder build an interactive mortgage payment calculator in a single html file
  ```

<a id="skill-web-design-guidelines"></a>
#### `web-design-guidelines` — Web UI Best Practices & Accessibility Auditor
- **Source Folder:** [web-design-guidelines](../config/skills/web-design-guidelines)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Audits website code against official Web Interface Guidelines, checking accessibility (contrast, keyboard focus, screen readers) and UX design standards.
- **When to Use:** When reviewing frontend code to ensure it meets accessibility standards and best UX design practices.
- **Example Prompt:**
  ```text
  @web-design-guidelines audit index.html for accessibility and UI flaws
  ```

---

<a id="software-architecture-coding-refactoring"></a>
## 3. Software Architecture, Coding & Refactoring

*Engineering principles, minimalist architectures, TypeScript practices, and code cleaners.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Just opened an unfamiliar repo and need an architecture guide and entry points? | [`codebase-onboarding`](#skill-codebase-onboarding) | `@codebase-onboarding explain this repository` |
| Designing clean module boundaries and deep classes to avoid spaghetti code? | [`codebase-design`](#skill-codebase-design) | `@codebase-design design the auth module` |
| General principles to simplify code, remove bloat, and fix root causes? | [`engineering-principles`](#skill-engineering-principles) | `@engineering-principles debloat this module` |
| Want the simplest, zero-dependency, standard-library-first solution (YAGNI)? | [`ponytail`](#skill-ponytail) | `@ponytail implement a file watcher with zero dependencies` |
| Want to scan the codebase for all shortcut comments and build a tech debt ledger? | [`ponytail-debt`](#skill-ponytail-debt) | `@ponytail-debt scan for tech debt` |
| Code written by AI feels repetitive, bloated, or has robot boilerplate? | [`deslop`](#skill-deslop) | `@deslop clean up this controller file` |
| Code is cluttered with obvious, useless comments like '// increment i'? | [`no-comments`](#skill-no-comments) | `@no-comments remove noisy comments` |
| Writing TypeScript and want strict type safety, discriminated unions, and zero 'any'? | [`typescript-best-practices`](#skill-typescript-best-practices) | `@typescript-best-practices type this API` |
| Have API JSON or database tables and need TypeScript interfaces or Zod schemas? | [`schema-to-type`](#skill-schema-to-type) | `@schema-to-type generate types for this JSON` |
| Using weak or free models and need fast, token-efficient, low-context edits? | [`chisle`](#skill-chisle) | `@chisle refactor this script with minimal context` |

### Detailed Breakdown of Skills in Software Architecture, Coding & Refactoring

<a id="skill-chisle"></a>
#### `chisle` — High-Efficiency Minimalist Dev Mode
- **Source Folder:** [chisle](../config/skills/chisle)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** A hyper-efficient, minimal-overhead development and audit mode designed to execute changes cleanly with the least tokens possible.
- **When to Use:** When working with low-context or free models and you need focused, fast edits without conversational fluff.
- **Example Prompt:**
  ```text
  @chisle refactor this script with minimal context usage
  ```

<a id="skill-codebase-design"></a>
#### `codebase-design` — Deep Module & Clean Architecture Designer
- **Source Folder:** [codebase-design](../config/skills/codebase-design)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Guides the design of deep classes and modules (simple public interfaces hiding powerful internal complexity) based on clean architecture principles.
- **When to Use:** When refactoring messy spaghetti code or designing a new service to prevent tight coupling and high cognitive load.
- **Example Prompt:**
  ```text
  @codebase-design design a clean, decoupled service architecture for user authentication
  ```

<a id="skill-codebase-onboarding"></a>
#### `codebase-onboarding` — Codebase Architecture & Onboarding Guide
- **Source Folder:** [codebase-onboarding](../config/skills/codebase-onboarding)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Scans an unfamiliar codebase, maps its architecture, entry points, data flows, and key abstractions, and writes a clear developer onboarding guide.
- **When to Use:** When you first open a new repository and want a fast, high-level map of how everything connects and where to start.
- **Example Prompt:**
  ```text
  @codebase-onboarding analyze this repo and explain the architecture and key components
  ```

<a id="skill-deslop"></a>
#### `deslop` — AI Code Slop & Boilerplate Cleaner
- **Source Folder:** [deslop](../config/skills/deslop)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Cleans up repetitive, overly verbose, or hallucinated AI boilerplate, restoring idiomatic patterns and concise, clean coding style.
- **When to Use:** When code written by AI models feels bloated, repetitive, or cluttered with unnecessary defensive checks.
- **Example Prompt:**
  ```text
  @deslop clean up this controller file and remove AI-generated boilerplate
  ```

<a id="skill-engineering-principles"></a>
#### `engineering-principles` — Clean, Debloated Code Engineering Principles
- **Source Folder:** [engineering-principles](../config/skills/engineering-principles)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Enforces pragmatic software craftsmanship: subtract unnecessary code before adding, fix root causes, avoid over-engineering, and keep codebase lean.
- **When to Use:** When reviewing code for bloat, unnecessary abstractions, or overly complex designs.
- **Example Prompt:**
  ```text
  @engineering-principles simplify this module and remove unnecessary boilerplate
  ```

<a id="skill-no-comments"></a>
#### `no-comments` — Useless Comment Remover & Clean Code Polisher
- **Source Folder:** [no-comments](../config/skills/no-comments)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Finds and deletes redundant, obvious, or noisy comments that state what code clearly does, keeping only indispensable architectural explanations.
- **When to Use:** When code is polluted with comments like '// increment i' or redundant docstrings that obscure the actual logic.
- **Example Prompt:**
  ```text
  @no-comments strip obvious comments and make the code self-documenting
  ```

<a id="skill-ponytail"></a>
#### `ponytail` — Radical Simplicity & YAGNI Architecture
- **Source Folder:** [ponytail](../config/skills/ponytail)
- **Upstream Repository:** [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
- **What It Does:** Forces the simplest, laziest working solution: standard library first, zero extra dependencies, native platform features, and one line before fifty.
- **When to Use:** When you want to stop over-engineering and implement a feature with minimal lines and zero bloated dependencies.
- **Example Prompt:**
  ```text
  @ponytail implement this file watcher with zero third-party packages
  ```

<a id="skill-ponytail-debt"></a>
#### `ponytail-debt` — Technical Debt & Shortcut Ledger
- **Source Folder:** [ponytail-debt](../config/skills/ponytail-debt)
- **Upstream Repository:** [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
- **What It Does:** Scans the codebase for deliberate shortcuts (e.g., `# ponytail:` comments) and compiles them into a prioritized technical debt roadmap.
- **When to Use:** When planning a cleanup sprint and you want to know all shortcuts taken across the project.
- **Example Prompt:**
  ```text
  @ponytail-debt scan the repository and build a technical debt report
  ```

<a id="skill-schema-to-type"></a>
#### `schema-to-type` — Schema to Strongly-Typed Code Generator
- **Source Folder:** [schema-to-type](../config/skills/schema-to-type)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Converts raw JSON data, OpenAPI specifications, or database schemas into type-safe code structures (TypeScript interfaces, Zod schemas, or Pydantic models).
- **When to Use:** When integrating with an external API and you need typed models matching the API's JSON responses.
- **Example Prompt:**
  ```text
  @schema-to-type generate TypeScript types and Zod schemas for this user API payload
  ```

<a id="skill-typescript-best-practices"></a>
#### `typescript-best-practices` — TypeScript Idioms & Type Safety Guide
- **Source Folder:** [typescript-best-practices](../config/skills/typescript-best-practices)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Enforces strict, idiomatic TypeScript practices: eliminating 'any', proper discriminated unions, type narrowing, and sound async error handling.
- **When to Use:** When writing or refactoring TypeScript code and you want bulletproof type safety and great autocomplete.
- **Example Prompt:**
  ```text
  @typescript-best-practices refactor these API interfaces to use discriminated unions
  ```

---

<a id="testing-verification-debugging"></a>
## 4. Testing, Verification & Debugging

*Root-cause debugging, test suites, benchmarks, and pre-completion proof enforcers.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Something is broken, crashing, or throwing errors and you need the real root cause? | [`systematic-debugging`](#skill-systematic-debugging) | `@systematic-debugging debug why auth fails` |
| Need to write unit tests, mocks, fixtures, or integration test suites? | [`test-quality`](#skill-test-quality) | `@test-quality write tests for user registration` |
| Want absolute proof (running tests/linters) before accepting work is done? | [`verification-before-completion`](#skill-verification-before-completion) | `@verification-before-completion verify all tests pass` |
| Application runs slowly, has CPU spikes, or leaks memory? | [`performance-profiling`](#skill-performance-profiling) | `@performance-profiling find the latency bottleneck` |
| Running a performance benchmark and want to verify the numbers are accurate? | [`benchmark-checklist`](#skill-benchmark-checklist) | `@benchmark-checklist audit our benchmark` |
| The AI keeps making the same mistake repeatedly on this project? | [`correct`](#skill-correct) | `@correct add rules preventing this recurring bug` |

### Detailed Breakdown of Skills in Testing, Verification & Debugging

<a id="skill-benchmark-checklist"></a>
#### `benchmark-checklist` — Rigorous Benchmark & Perf Audit Checklist
- **Source Folder:** [benchmark-checklist](../config/skills/benchmark-checklist)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Vets performance measurements against systematic criteria: warm-up runs, system limits, measurement noise, and statistical significance.
- **When to Use:** When running benchmarks or comparing two implementations to make sure the speed numbers are genuine.
- **Example Prompt:**
  ```text
  @benchmark-checklist audit our latency benchmark methodology
  ```

<a id="skill-correct"></a>
#### `correct` — Repeated Mistake Prevention & Rule Guard
- **Source Folder:** [correct](../config/skills/correct)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Analyzes recurring coding or configuration errors made by AI agents in your repository and encodes preventative rules so they never happen again.
- **When to Use:** When the AI keeps making the same mistake or bad assumption on a specific project.
- **Example Prompt:**
  ```text
  @correct diagnose our recurring build failures and add guardrails against them
  ```

<a id="skill-performance-profiling"></a>
#### `performance-profiling` — Performance Profiling & Bottleneck Analyzer
- **Source Folder:** [performance-profiling](../config/skills/performance-profiling)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Diagnoses CPU hotspots, memory leaks, event loop delays, and unoptimized I/O loops using profilers and flamegraphs.
- **When to Use:** When your application runs slowly, consumes too much RAM, or suffers from high latency spikes.
- **Example Prompt:**
  ```text
  @performance-profiling find why the data parsing loop is taking 8 seconds
  ```

<a id="skill-systematic-debugging"></a>
#### `systematic-debugging` — Root-Cause Systematic Debugger
- **Source Folder:** [systematic-debugging](../config/skills/systematic-debugging)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Enforces disciplined debugging: reproduce the issue first, form testable hypotheses, isolate root cause, and verify fixes before writing code.
- **When to Use:** When an error, test failure, or unexpected bug occurs and you want to fix the real cause instead of guessing.
- **Example Prompt:**
  ```text
  @systematic-debugging investigate why the session authentication fails
  ```

<a id="skill-test-quality"></a>
#### `test-quality` — Comprehensive Test Suite & Mocking Specialist
- **Source Folder:** [test-quality](../config/skills/test-quality)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Designs and writes high-coverage unit, integration, and end-to-end tests with realistic edge cases, clean fixtures, and proper mocking.
- **When to Use:** When adding tests for an existing feature, fixing brittle tests, or improving overall test coverage.
- **Example Prompt:**
  ```text
  @test-quality write comprehensive unit and integration tests for user registration
  ```

<a id="skill-verification-before-completion"></a>
#### `verification-before-completion` — Strict Pre-Completion Proof Enforcer
- **Source Folder:** [verification-before-completion](../config/skills/verification-before-completion)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Requires running tests, linters, or build commands and verifying positive output before asserting that a task is finished or working.
- **When to Use:** When you want absolute proof that everything compiles and passes tests before finishing a turn.
- **Example Prompt:**
  ```text
  @verification-before-completion run test suites and verify all checks pass
  ```

---

<a id="code-review-auditing-security"></a>
## 5. Code Review, Auditing & Security

*Deep branch audits, OWASP security checks, impact analysis, and critical objective reviews.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Standard, friendly peer code review for readability, logic, and style? | [`code-review`](#skill-code-review) | `@code-review review my branch diff` |
| Ruthless, uncompromising security & correctness audit before production? | [`thermo-nuclear-review`](#skill-thermo-nuclear-review) | `@thermo-nuclear-review audit the payment branch` |
| Ruthless audit hunting for oversized files, bloat, and messy abstractions? | [`thermo-nuclear-code-quality-review`](#skill-thermo-nuclear-code-quality-review) | `@thermo-nuclear-code-quality-review audit this module` |
| Want BOTH ruthless security AND code quality audits run in parallel? | [`thermos`](#skill-thermos) | `@thermos perform a dual audit of the PR` |
| Specifically checking for web security holes (SQL injection, XSS, auth flaws)? | [`owasp-security`](#skill-owasp-security) | `@owasp-security audit API endpoints for vulnerabilities` |
| Want to check what other files or services will break if you make a change? | [`blast-radius`](#skill-blast-radius) | `@blast-radius check the impact of changing User.id` |
| Want the AI to critically challenge your bad assumptions instead of agreeing? | [`anti-sycophancy`](#skill-anti-sycophancy) | `@anti-sycophancy critically evaluate this design` |

### Detailed Breakdown of Skills in Code Review, Auditing & Security

<a id="skill-anti-sycophancy"></a>
#### `anti-sycophancy` — Objective Critical Thinker & Truth Enforcer
- **Source Folder:** [anti-sycophancy](../config/skills/anti-sycophancy)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Forces the assistant to remain rigorously truthful, challenging flawed assumptions, false claims, and invalid logic instead of politely agreeing.
- **When to Use:** When you want an honest, unvarnished critical assessment of an idea, design, or architecture plan.
- **Example Prompt:**
  ```text
  @anti-sycophancy critically evaluate this database migration strategy
  ```

<a id="skill-blast-radius"></a>
#### `blast-radius` — Change Impact & Blast Radius Calculator
- **Source Folder:** [blast-radius](../config/skills/blast-radius)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Calculates downstream dependencies and side effects of a code change to reveal what elsewhere could break before you ship.
- **When to Use:** When modifying shared database schemas, common utilities, or core API contracts.
- **Example Prompt:**
  ```text
  @blast-radius check what parts of the app will be affected if we change User.id to UUID
  ```

<a id="skill-code-review"></a>
#### `code-review` — Two-Sided Peer Code Reviewer
- **Source Folder:** [code-review](../config/skills/code-review)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Conducts thorough code reviews examining correctness, security vulnerabilities, edge cases, maintainability, and code style.
- **When to Use:** When preparing a pull request or reviewing changes before merging into your main branch.
- **Example Prompt:**
  ```text
  @code-review review the changes between main and feature-branch
  ```

<a id="skill-owasp-security"></a>
#### `owasp-security` — OWASP Top 10 Security & Vulnerability Auditor
- **Source Folder:** [owasp-security](../config/skills/owasp-security)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Audits application code against OWASP Top 10 vulnerabilities: injection, broken authentication, sensitive data exposure, and security misconfigurations.
- **When to Use:** When writing security-sensitive code (auth, payment, sessions, APIs) or doing a security hardening sweep.
- **Example Prompt:**
  ```text
  @owasp-security audit our API endpoints for SQL injection and auth bypass risks
  ```

<a id="skill-thermo-nuclear-code-quality-review"></a>
#### `thermo-nuclear-code-quality-review` — Extreme Maintainability & Abstraction Review
- **Source Folder:** [thermo-nuclear-code-quality-review](../config/skills/thermo-nuclear-code-quality-review)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** A ruthless code maintainability review hunting down oversized files, abstraction sprawl, god objects, and unneeded complexity.
- **When to Use:** When reviewing code for long-term health and architectural cleanliness before it becomes tech debt.
- **Example Prompt:**
  ```text
  @thermo-nuclear-code-quality-review audit this new backend module
  ```

<a id="skill-thermo-nuclear-review"></a>
#### `thermo-nuclear-review` — Deep Security & Correctness Branch Auditor
- **Source Folder:** [thermo-nuclear-review](../config/skills/thermo-nuclear-review)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** An exhaustive, uncompromising audit of git branch diffs looking for hidden race conditions, auth bypasses, resource leaks, and data hazards.
- **When to Use:** When reviewing mission-critical code changes where security or stability failures are unacceptable.
- **Example Prompt:**
  ```text
  @thermo-nuclear-review audit our payment processing branch before deployment
  ```

<a id="skill-thermos"></a>
#### `thermos` — Dual-Auditor Parallel Security & Quality Review
- **Source Folder:** [thermos](../config/skills/thermos)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Runs both thermo-nuclear security and code-quality reviews in parallel, synthesizing their findings into a single prioritized report.
- **When to Use:** When you want the ultimate, all-angles review of a major feature branch in one pass.
- **Example Prompt:**
  ```text
  @thermos perform a comprehensive audit of the latest pull request
  ```

---

<a id="git-devops-containers-deployment"></a>
## 6. Git, DevOps, Containers & Deployment

*Git workflows, merge conflict resolutions, Docker optimization, and CI/CD pipelines.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Organizing git commits, conventional commits, and clean PR histories? | [`git-workflow`](#skill-git-workflow) | `@git-workflow organize our staged commits` |
| Stuck in a nasty merge conflict, rebase collision, or detached HEAD? | [`git-conflict-resolver`](#skill-git-conflict-resolver) | `@git-conflict-resolver resolve merge conflicts in app.ts` |
| Want to work on another branch in parallel without stashing or switching directories? | [`using-git-worktrees`](#skill-using-git-worktrees) | `@using-git-worktrees create a worktree for bugfix` |
| Creating or shrinking Dockerfiles, multi-stage builds, or compose setups? | [`docker-infra`](#skill-docker-infra) | `@docker-infra optimize our Dockerfile` |
| Setting up GitHub Actions, CI/CD pipelines, or automated deployment scripts? | [`deployment-patterns`](#skill-deployment-patterns) | `@deployment-patterns create a CI pipeline` |
| Ready to bump SemVer, generate a changelog, and tag a software release? | [`publishing-release`](#skill-publishing-release) | `@publishing-release prepare a v1.2.0 release` |
| Auditing an app for production readiness (rate limits, timeouts, crash recovery)? | [`production-hardening`](#skill-production-hardening) | `@production-hardening audit this service` |

### Detailed Breakdown of Skills in Git, DevOps, Containers & Deployment

<a id="skill-deployment-patterns"></a>
#### `deployment-patterns` — CI/CD Pipelines & Deployment Architectures
- **Source Folder:** [deployment-patterns](../config/skills/deployment-patterns)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Configures end-to-end deployment workflows: GitHub Actions, automated testing pipelines, Docker publishing, and blue/green deployments.
- **When to Use:** When setting up continuous integration/continuous deployment (CI/CD) pipelines from scratch.
- **Example Prompt:**
  ```text
  @deployment-patterns create a GitHub Actions workflow that tests and builds our app
  ```

<a id="skill-docker-infra"></a>
#### `docker-infra` — Docker, Compose & Container Infrastructure
- **Source Folder:** [docker-infra](../config/skills/docker-infra)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Creates and optimizes production-ready Dockerfiles, multi-stage builds, docker-compose.yml files, and health checks with minimal image size.
- **When to Use:** When containerizing a new application, reducing huge image sizes, or configuring local development compose setups.
- **Example Prompt:**
  ```text
  @docker-infra write a multi-stage Dockerfile and docker-compose.yml for this FastAPI app
  ```

<a id="skill-git-conflict-resolver"></a>
#### `git-conflict-resolver` — Git Merge Conflict & Rebase Resolver
- **Source Folder:** [git-conflict-resolver](../config/skills/git-conflict-resolver)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Resolves complex git merge conflicts, rebase collisions, and detached HEAD states systematically without losing code changes.
- **When to Use:** When git rebase or merge runs into gnarly file conflicts with lots of overlapping changes.
- **Example Prompt:**
  ```text
  @git-conflict-resolver resolve the merge conflict in src/app.ts
  ```

<a id="skill-git-workflow"></a>
#### `git-workflow` — Git Branching, Commit Conventions & PRs
- **Source Folder:** [git-workflow](../config/skills/git-workflow)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Guides clean Git practices: conventional commit messages, feature branch workflows, PR templates, and maintaining clean git history.
- **When to Use:** When organizing git commits, setting up git branching workflows, or preparing a clean PR history.
- **Example Prompt:**
  ```text
  @git-workflow organize our staged commits into conventional commit format
  ```

<a id="skill-production-hardening"></a>
#### `production-hardening` — Production Readiness & Hardening Audit
- **Source Folder:** [production-hardening](../config/skills/production-hardening)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Audits applications before production launch: configuring crash recovery, rate limiting, secure HTTP headers, timeouts, and error handling.
- **When to Use:** When taking a prototype to real production traffic and ensuring it won't crash or leak sensitive data.
- **Example Prompt:**
  ```text
  @production-hardening audit this web service for production readiness
  ```

<a id="skill-publishing-release"></a>
#### `publishing-release` — Software Release & Publishing Checklist
- **Source Folder:** [publishing-release](../config/skills/publishing-release)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Automates the release process: version bumping (SemVer), changelog generation from git commits, git tagging, and package publishing.
- **When to Use:** When your code is tested and ready to release as a new version or package.
- **Example Prompt:**
  ```text
  @publishing-release prepare a v1.2.0 release with a generated changelog
  ```

<a id="skill-using-git-worktrees"></a>
#### `using-git-worktrees` — Git Worktrees Parallel Branch Manager
- **Source Folder:** [using-git-worktrees](../config/skills/using-git-worktrees)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Sets up and manages Git worktrees to work on multiple branches simultaneously in isolated directories without stashing or switching branches.
- **When to Use:** When you need to review a bug fix or test a branch without interrupting your active working directory.
- **Most Commonly Used Commands:**
  ```bash
  git worktree add ../<branch-name> <branch>  # Create an isolated workspace directory
  git worktree list                           # View all active worktrees and checked out branches
  git worktree remove ../<branch-name>        # Safely remove worktree after merge
  ```
- **Example Prompt:**
  ```text
  @using-git-worktrees create an isolated worktree for bugfix-auth
  ```

---

<a id="database-backend-cloud"></a>
## 7. Database, Backend & Cloud

*Safe migrations, high-performance SQL, query tuning, and Supabase integrations.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Modifying database tables with zero downtime, defaults, and rollbacks? | [`database-migrations`](#skill-database-migrations) | `@database-migrations add a column safely` |
| Writing complex, high-performance SQL queries (joins, window functions, CTEs)? | [`data-sql-queries`](#skill-data-sql-queries) | `@data-sql-queries write a user cohort query` |
| An existing database query is running slow and needs EXPLAIN ANALYZE tuning? | [`data-write-query`](#skill-data-write-query) | `@data-write-query optimize this query` |
| Building with Supabase (Auth, Row-Level Security, Edge Functions, Realtime)? | [`supabase`](#skill-supabase) | `@supabase configure RLS policies for notes` |

### Detailed Breakdown of Skills in Database, Backend & Cloud

<a id="skill-data-sql-queries"></a>
#### `data-sql-queries` — Multi-Dialect SQL Query Specialist
- **Source Folder:** [data-sql-queries](../config/skills/data-sql-queries)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Writes accurate, high-performance SQL queries across major database engines (PostgreSQL, MySQL, SQLite, Snowflake, BigQuery, DuckDB).
- **When to Use:** When writing complex joins, window functions, CTEs, or aggregations for reports and backend queries.
- **Example Prompt:**
  ```text
  @data-sql-queries write a PostgreSQL query calculating 30-day user retention cohorts
  ```

<a id="skill-data-write-query"></a>
#### `data-write-query` — SQL Query Optimization & Performance Tuning
- **Source Folder:** [data-write-query](../config/skills/data-write-query)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Diagnoses slow SQL queries using query execution plans (EXPLAIN ANALYZE), missing indexes, and query restructuring.
- **When to Use:** When a database query takes too long to run and needs to be optimized for low latency.
- **Example Prompt:**
  ```text
  @data-write-query optimize this slow orders report query
  ```

<a id="skill-database-migrations"></a>
#### `database-migrations` — Safe Database Schema Migrations
- **Source Folder:** [database-migrations](../config/skills/database-migrations)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Designs safe, non-locking database migrations with zero downtime, proper rollback scripts, column defaults, and index creation.
- **When to Use:** When altering production database tables, adding foreign keys, or altering large tables without downtime.
- **Example Prompt:**
  ```text
  @database-migrations create a zero-downtime migration for adding email_verified to users table
  ```

<a id="skill-supabase"></a>
#### `supabase` — Supabase Backend & Database Platform
- **Source Folder:** [supabase](../config/skills/supabase)
- **Upstream Repository:** [supabase/cli](https://github.com/supabase/cli)
- **What It Does:** Comprehensive guide for Supabase: PostgreSQL database, Auth, Row-Level Security (RLS) policies, Realtime, Storage, and Edge Functions.
- **When to Use:** When building apps with Supabase, setting up RLS policies, configuring Auth, or debugging Supabase client libraries.
- **Most Commonly Used Commands:**
  ```bash
  supabase db diff                         # Inspect uncommitted declarative schema changes
  supabase migration new <name>            # Scaffold a new SQL migration file
  supabase gen types typescript --local    # Generate TypeScript types from local database
  supabase functions serve <name>          # Test a Supabase Edge Function locally
  ```
- **Example Prompt:**
  ```text
  @supabase configure Row-Level Security policies for our multi-tenant notes table
  ```

---

<a id="data-science-analytics-visualizations"></a>
## 8. Data Science, Analytics & Visualizations

*Exploratory data analysis, statistics, A/B testing, dashboards, machine learning, and plotting.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Have a dataset and need answers to business and trend questions? | [`data-analyze`](#skill-data-analyze) | `@data-analyze analyze customer_churn.csv` |
| Just received a new dataset and want to explore nulls, shapes, and distributions? | [`data-explore-data`](#skill-data-explore-data) | `@data-explore-data profile sales_data.csv` |
| Need formal statistical hypothesis tests, regressions, ANOVA, or p-values? | [`data-statistical-analysis`](#skill-data-statistical-analysis) | `@data-statistical-analysis test significance` |
| Designing an A/B test or calculating statistical power and sample size? | [`experiment-and-inference`](#skill-experiment-and-inference) | `@experiment-and-inference calculate sample size` |
| Auditing a data report for math bugs, calculation errors, or bias before presenting? | [`data-validate-data`](#skill-data-validate-data) | `@data-validate-data QA our segmentation findings` |
| Creating publication-ready charts in Python (Matplotlib, Seaborn, Plotly)? | [`data-visualization`](#skill-data-visualization) | `@data-visualization plot revenue trends` |
| Need a quick visual chart generated fast with minimal code? | [`data-create-viz`](#skill-data-create-viz) | `@data-create-viz generate a histogram` |
| Building a standalone interactive HTML dashboard with charts and filters? | [`data-build-dashboard`](#skill-data-build-dashboard) | `@data-build-dashboard build an interactive dashboard` |
| Training machine learning models (classification/regression with Scikit-Learn/XGBoost)? | [`ml-workflow`](#skill-ml-workflow) | `@ml-workflow train a churn prediction model` |
| Building an end-to-end data analytics project to showcase in a portfolio? | [`portfolio-project-builder`](#skill-portfolio-project-builder) | `@portfolio-project-builder build a portfolio project` |
| Want an interactive teacher to explain data science or math concepts simply? | [`data-science-tutor`](#skill-data-science-tutor) | `@data-science-tutor explain gradient descent` |
| Documenting company data definitions, warehouse rules, and tribal knowledge? | [`data-context-extractor`](#skill-data-context-extractor) | `@data-context-extractor document metric definitions` |

### Detailed Breakdown of Skills in Data Science, Analytics & Visualizations

<a id="skill-data-analyze"></a>
#### `data-analyze` — End-to-End Data Analysis Specialist
- **Source Folder:** [data-analyze](../config/skills/data-analyze)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Conducts complete data analyses from raw CSV/database records: data cleaning, summarization, trend detection, and answering business questions.
- **When to Use:** When you have a dataset and need actionable answers, business summaries, or pattern discoveries.
- **Example Prompt:**
  ```text
  @data-analyze analyze customer_churn.csv and identify the top drivers of churn
  ```

<a id="skill-data-build-dashboard"></a>
#### `data-build-dashboard` — Interactive HTML Analytics Dashboard
- **Source Folder:** [data-build-dashboard](../config/skills/data-build-dashboard)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Builds interactive, self-contained HTML dashboards containing charts, date range filters, KPI cards, and sortable data tables.
- **When to Use:** When you want to deliver an interactive reporting tool to stakeholders that runs without requiring a backend server.
- **Example Prompt:**
  ```text
  @data-build-dashboard build an interactive sales dashboard from monthly_sales.csv
  ```

<a id="skill-data-context-extractor"></a>
#### `data-context-extractor` — Domain Knowledge & Warehouse Context Extractor
- **Source Folder:** [data-context-extractor](../config/skills/data-context-extractor)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Extracts organizational tribal knowledge, table definitions, and business logic from analysts into a reusable domain skill.
- **When to Use:** When documenting data warehouse schemas and metric calculation rules for a company or project.
- **Example Prompt:**
  ```text
  @data-context-extractor document our company data warehouse business definitions
  ```

<a id="skill-data-create-viz"></a>
#### `data-create-viz` — Fast Python Visual Chart Generator
- **Source Folder:** [data-create-viz](../config/skills/data-create-viz)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Quickly generates focused charts and plots for data exploration and reporting with minimal code.
- **When to Use:** When you want a quick visual representation of a table or series without manual plotting setup.
- **Example Prompt:**
  ```text
  @data-create-viz generate a histogram of user session durations
  ```

<a id="skill-data-explore-data"></a>
#### `data-explore-data` — Exploratory Data Analysis (EDA) & Profiling
- **Source Folder:** [data-explore-data](../config/skills/data-explore-data)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Profiles raw datasets to inspect shapes, null values, distributions, anomalies, data types, and correlation structures.
- **When to Use:** When you receive a new dataset and want to understand what is inside before starting any modeling or reporting.
- **Example Prompt:**
  ```text
  @data-explore-data profile sales_data.csv and summarize missing values and distributions
  ```

<a id="skill-data-science-tutor"></a>
#### `data-science-tutor` — Personal Data Science & Statistics Tutor
- **Source Folder:** [data-science-tutor](../config/skills/data-science-tutor)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** An interactive tutor that explains machine learning, math, and data science concepts in simple, intuitive terms with practical examples.
- **When to Use:** When learning a complex statistical or machine learning concept and you want plain-English explanations.
- **Example Prompt:**
  ```text
  @data-science-tutor explain how gradient descent works in simple terms
  ```

<a id="skill-data-statistical-analysis"></a>
#### `data-statistical-analysis` — Rigorous Statistical Analysis & Testing
- **Source Folder:** [data-statistical-analysis](../config/skills/data-statistical-analysis)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Applies classical and modern statistical methods: hypothesis testing (t-tests, chi-square), ANOVA, regression models, and confidence intervals.
- **When to Use:** When you need to mathematically prove whether differences in data are statistically significant.
- **Example Prompt:**
  ```text
  @data-statistical-analysis test if conversion rates between version A and B are statistically significant
  ```

<a id="skill-data-validate-data"></a>
#### `data-validate-data` — Data Analysis QA & Bias Check
- **Source Folder:** [data-validate-data](../config/skills/data-validate-data)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Audits data conclusions and methodologies before sharing: checks for sampling bias, survivorship bias, metric calculation errors, and outliers.
- **When to Use:** When you want to verify that an analysis or executive report is mathematically sound and error-free.
- **Example Prompt:**
  ```text
  @data-validate-data QA our customer segmentation findings before the executive meeting
  ```

<a id="skill-data-visualization"></a>
#### `data-visualization` — Data Visualization Expert (Matplotlib, Seaborn, Plotly)
- **Source Folder:** [data-visualization](../config/skills/data-visualization)
- **Upstream Repository:** [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- **What It Does:** Builds clear, publication-ready charts and graphs in Python with proper labels, legible axes, clean color scales, and high DPI.
- **When to Use:** When creating charts for reports, articles, or presentations using Python.
- **Example Prompt:**
  ```text
  @data-visualization plot monthly revenue growth using Seaborn with a clean theme
  ```

<a id="skill-experiment-and-inference"></a>
#### `experiment-and-inference` — A/B Testing & Causal Inference Design
- **Source Folder:** [experiment-and-inference](../config/skills/experiment-and-inference)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Designs controlled experiments and A/B tests: sample size calculations, power analysis, randomization, and causal effect estimation.
- **When to Use:** When designing an experiment or interpreting A/B test results without falling for statistical traps.
- **Example Prompt:**
  ```text
  @experiment-and-inference calculate the sample size required for a 5% detectable lift
  ```

<a id="skill-ml-workflow"></a>
#### `ml-workflow` — Machine Learning Pipeline (Scikit-Learn / XGBoost)
- **Source Folder:** [ml-workflow](../config/skills/ml-workflow)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Guides sound machine learning workflows: feature engineering, train/validation/test splits, cross-validation, hyperparameter tuning, and metric evaluation.
- **When to Use:** When building predictive models (classification, regression) without data leakage.
- **Example Prompt:**
  ```text
  @ml-workflow train an XGBoost model predicting customer churn with cross-validation
  ```

<a id="skill-portfolio-project-builder"></a>
#### `portfolio-project-builder` — Data Analyst Portfolio Project Builder
- **Source Folder:** [portfolio-project-builder](../config/skills/portfolio-project-builder)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Helps build end-to-end, interview-ready data science and analytics portfolio projects with clean code, READMEs, and executive summaries.
- **When to Use:** When assembling showcase projects for job applications, resumes, or public GitHub portfolios.
- **Example Prompt:**
  ```text
  @portfolio-project-builder outline a portfolio project analyzing public bike share data
  ```

---

<a id="web-research-academic-document-intelligence"></a>
## 9. Web Research, Academic & Document Intelligence

*Web queries, deep research dossiers, academic paper pipelines, and photo geolocation.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Quick web search for facts, library docs, or competitor comparisons? | [`web-research`](#skill-web-research) | `@web-research compare Supabase vs Firebase` |
| Comprehensive multi-source topic research creating an exhaustive dossier? | [`deep-research`](#skill-deep-research) | `@deep-research research local LLM quantization` |
| Drafting, formatting, or revising an academic journal paper or literature review? | [`academic-paper`](#skill-academic-paper) | `@academic-paper draft the literature review` |
| Simulating a harsh 5-seat peer review panel to critique your paper draft? | [`academic-paper-reviewer`](#skill-academic-paper-reviewer) | `@academic-paper-reviewer simulate a review of draft.pdf` |
| Full academic research lifecycle (research -> draft -> review -> revise -> publish)? | [`academic-pipeline`](#skill-academic-pipeline) | `@academic-pipeline coordinate the paper workflow` |
| Screening paper abstracts against inclusion/exclusion criteria for systematic reviews? | [`sr-screener`](#skill-sr-screener) | `@sr-screener screen these 50 paper abstracts` |
| Finding where or at what time of day a photo was taken? | [`geo-sleuth`](#skill-geo-sleuth) | `@geo-sleuth identify the location of photo.jpg` |
| Fetching current, up-to-date documentation for modern libraries and frameworks? | [`documentation-lookup`](#skill-documentation-lookup) | `@documentation-lookup check Next.js 15 caching API` |

### Detailed Breakdown of Skills in Web Research, Academic & Document Intelligence

<a id="skill-academic-paper"></a>
#### `academic-paper` — 12-Agent Academic Paper Writing Pipeline
- **Source Folder:** [academic-paper](../config/skills/academic-paper)
- **Upstream Repository:** [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills)
- **What It Does:** Full academic manuscript writing assistant supporting 11 modes (literature reviews, outlines, drafts, citations, LaTeX/Pandoc formatting).
- **When to Use:** When writing or formatting academic papers, journal submissions, or conference responses.
- **Most Commonly Used Modes:**
  ```text
  academic-paper full                      # Run complete 12-agent research and writing pipeline
  academic-paper plan                      # Deconstruct research questions into paper outline
  academic-paper draft <section>           # Deep-dive draft for a specific section (e.g. Methodology)
  academic-paper review                    # Multi-perspective peer review simulation
  ```
- **Example Prompt:**
  ```text
  @academic-paper draft the literature review section for our graph neural network paper
  ```

<a id="skill-academic-paper-reviewer"></a>
#### `academic-paper-reviewer` — Multi-Perspective Peer Review Simulator
- **Source Folder:** [academic-paper-reviewer](../config/skills/academic-paper-reviewer)
- **Upstream Repository:** [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills)
- **What It Does:** Simulates a rigorous 5-seat journal peer review panel (Journal-Fit Reviewer + 3 domain experts + Devil's Advocate) providing actionable critiques.
- **When to Use:** When you want harsh, realistic feedback on an academic paper draft before submitting to a real journal or conference.
- **Example Prompt:**
  ```text
  @academic-paper-reviewer simulate a peer review of draft.pdf
  ```

<a id="skill-academic-pipeline"></a>
#### `academic-pipeline` — End-to-End Academic Research Pipeline
- **Source Folder:** [academic-pipeline](../config/skills/academic-pipeline)
- **Upstream Repository:** [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills)
- **What It Does:** Orchestrates the entire academic journey: literature search, paper drafting, integrity/citation checks, peer review simulation, and revision.
- **When to Use:** When embarking on an end-to-end research paper project from initial idea to final submission-ready PDF.
- **Example Prompt:**
  ```text
  @academic-pipeline coordinate researching, writing, and reviewing our research topic
  ```

<a id="skill-deep-research"></a>
#### `deep-research` — Deep Topic Research & Multi-Source Synthesis
- **Source Folder:** [deep-research](../config/skills/deep-research)
- **Upstream Repository:** [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills)
- **What It Does:** Executes thorough, exhaustive research on complex topics, cross-referencing multiple authoritative sources to produce a structured dossier.
- **When to Use:** When preparing a comprehensive research brief, market analysis, or deep technical investigation.
- **Example Prompt:**
  ```text
  @deep-research research state-of-the-art methods in local LLM quantization
  ```

<a id="skill-documentation-lookup"></a>
#### `documentation-lookup` — Up-to-Date Official Documentation Lookup
- **Source Folder:** [documentation-lookup](../config/skills/documentation-lookup)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Fetches current, up-to-date documentation for libraries, frameworks, and APIs directly instead of relying on outdated training memory.
- **When to Use:** When using new library versions, recently changed APIs, or SDKs that change frequently.
- **Example Prompt:**
  ```text
  @documentation-lookup check the latest Next.js 15 App Router caching API
  ```

<a id="skill-geo-sleuth"></a>
#### `geo-sleuth` — Photo Geolocation & Chronolocation Sleuth
- **Source Folder:** [geo-sleuth](../config/skills/geo-sleuth)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Geolocates or chronolocates photos using tool-verified evidence: camera metadata (EXIF), landmarks, sun shadow math, street view, and OCR signs.
- **When to Use:** When you have a photo and want to pinpoint where or at what time of day it was taken.
- **Example Prompt:**
  ```text
  @geo-sleuth identify the location of this photo photo.jpg
  ```

<a id="skill-sr-screener"></a>
#### `sr-screener` — Systematic & Scoping Review Study Screener
- **Source Folder:** [sr-screener](../config/skills/sr-screener)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Screen scientific studies and papers against strict inclusion/exclusion criteria according to PRISMA protocols for systematic reviews.
- **When to Use:** When conducting medical, clinical, or scientific systematic literature reviews.
- **Example Prompt:**
  ```text
  @sr-screener screen these 50 paper abstracts against our inclusion criteria
  ```

<a id="skill-web-research"></a>
#### `web-research` — Fast Web Research & Information Gathering
- **Source Folder:** [web-research](../config/skills/web-research)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Searches the web across multiple sources, extracts key facts, and compiles concise, cited summaries with direct source URLs.
- **When to Use:** When you need to look up current documentation, pricing, release notes, or factual answers from the internet.
- **Example Prompt:**
  ```text
  @web-research find the latest pricing and features of Supabase vs Firebase
  ```

---

<a id="autonomous-multi-agent-orchestration"></a>
## 10. Autonomous Multi-Agent & Orchestration

*Lifecycle planning, subagent task execution, prompt sharpening, and structured ideation.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Routing a project across lifecycle stages (planning, coding, testing, release)? | [`agentskills`](#skill-agentskills) | `@agentskills route this feature across SDLC` |
| Breaking a complex plan into tasks executed by focused subagents? | [`subagent-driven-development`](#skill-subagent-driven-development) | `@subagent-driven-development execute PLAN.md` |
| Running a multi-agent swarm via the local Ruflo CLI? | [`ruflo`](#skill-ruflo) | `@ruflo coordinate a multi-agent review` |
| Running automated evaluation benchmarks via the REA CLI? | [`rea`](#skill-rea) | `@rea run evaluation benchmarks` |
| Drafting a comprehensive implementation plan before touching code? | [`plans`](#skill-plans) | `/plan design a rate limiter for our API` |
| Taking a vague prompt and sharpening it into a deep, precise specification? | [`sharpen`](#skill-sharpen) | `@sharpen turn my rough idea into a spec` |
| Exploring multiple technical approaches and tradeoffs before deciding? | [`brainstorming`](#skill-brainstorming) | `@brainstorming explore caching strategies` |

### Detailed Breakdown of Skills in Autonomous Multi-Agent & Orchestration

<a id="skill-agentskills"></a>
#### `agentskills` — Universal Software Lifecycle (SDLC) Router
- **Source Folder:** [agentskills](../config/skills/agentskills)
- **Upstream Repository:** [agentskills/agentskills](https://github.com/agentskills/agentskills)
- **What It Does:** Orchestrates the software development lifecycle: detects whether you are Planning, Coding, Testing, or Releasing and applies the right disciplined workflow.
- **When to Use:** When managing complex software projects across multiple stages.
- **Example Prompt:**
  ```text
  @agentskills route this new feature through planning, coding, and verification
  ```

<a id="skill-brainstorming"></a>
#### `brainstorming` — Structured Design Ideation & Tradeoff Explorer
- **Source Folder:** [brainstorming](../config/skills/brainstorming)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Facilitates structured brainstorming: explores multiple technical approaches, weighs pros and cons, and clarifies requirements before deciding.
- **When to Use:** When exploring alternative architectural patterns or feature designs before committing to code.
- **Example Prompt:**
  ```text
  @brainstorming explore options for caching database queries
  ```

<a id="skill-plans"></a>
#### `plans` — Detailed Implementation Plan Creator
- **Source Folder:** [plans](../config/skills/plans)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Drafts structured, phased implementation plans before writing any code: outlines architectural decisions, risks, steps, and verification criteria.
- **When to Use:** When starting a non-trivial project or complex refactor and you want to align on the blueprint first.
- **Example Prompt:**
  ```text
  /plan design and implement a token-bucket rate limiter for our API
  ```

<a id="skill-rea"></a>
#### `rea` — REA Evaluation & Verification Engine
- **Source Folder:** [rea](../config/skills/rea)
- **Upstream Repository:** [rea-agent/rea](https://github.com/rea-agent/rea)
- **What It Does:** Runs automated evaluations, test suites, and capability verification benchmarks via the REA CLI tool.
- **When to Use:** When benchmarking agent performance or evaluating system metrics.
- **Example Prompt:**
  ```text
  @rea run evaluation benchmarks on our current setup
  ```

<a id="skill-ruflo"></a>
#### `ruflo` — Ruflo Multi-Agent Swarm Orchestrator
- **Source Folder:** [ruflo](../config/skills/ruflo)
- **Upstream Repository:** [ruvnet/ruflo](https://github.com/ruvnet/ruflo)
- **What It Does:** Invokes the Ruflo multi-agent CLI system to coordinate agent teams for complex parallel tasks.
- **When to Use:** When running multi-agent swarms using the local Ruflo command-line tool.
- **Example Prompt:**
  ```text
  @ruflo coordinate a multi-agent review of the repository
  ```

<a id="skill-sharpen"></a>
#### `sharpen` — Prompt Sharpener & Task Depth Enhancer
- **Source Folder:** [sharpen](../config/skills/sharpen)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Takes vague or broad prompts and sharpens them into concrete, actionable, deeply detailed specifications with defined boundaries.
- **When to Use:** When you have a rough idea and want the AI to refine it into a crystal-clear, high-quality prompt.
- **Example Prompt:**
  ```text
  @sharpen turn my rough idea 'make a dashboard' into a detailed specification
  ```

<a id="skill-subagent-driven-development"></a>
#### `subagent-driven-development` — Subagent Task Decomposition & Execution
- **Source Folder:** [subagent-driven-development](../config/skills/subagent-driven-development)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Takes an implementation plan and executes it by dispatching focused, independent subagents for each subtask with strict verification gates.
- **When to Use:** When tackling large multi-file refactors or implementations that benefit from modular execution.
- **Example Prompt:**
  ```text
  @subagent-driven-development execute the tasks outlined in PLAN.md
  ```

---

<a id="creative-media-gaming-3d"></a>
## 11. Creative, Media, Gaming & 3D

*AI image/video generation, programmatic film direction, Godot 4, generative art, and 3D voxels.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Generating an image from a text prompt using free AI backends? | [`image-gen`](#skill-image-gen) | `@image-gen generate a cyberpunk city illustration` |
| Editing an existing video/audio file (cut, captions, reframe, loudness, exports)? | [`ffmpeg`](#skill-ffmpeg) | `@ffmpeg cut clip.mp4 to 15 seconds and add burned-in captions` |
| Animated line-art / ink illustrations (walking people, day-night scenes) as an SVG component or video? | [`line-art-animation`](#skill-line-art-animation) | `@line-art-animation a little ink scene of a baker opening his shop at dawn` |
| Generating a short video clip from a text prompt? | [`video-gen`](#skill-video-gen) | `@video-gen generate a 5-second video clip` |
| Creating interactive generative art, flow fields, or math patterns with p5.js? | [`algorithmic-art`](#skill-algorithmic-art) | `@algorithmic-art build a particle flow field in p5.js` |
| Developing 2D/3D game mechanics or UI in Godot 4 with GDScript 2.0? | [`godot4-dev`](#skill-godot4-dev) | `@godot4-dev build a character controller script` |
| Generating procedural 3D voxel structures and architectural math models? | [`voxel-craft-cad`](#skill-voxel-craft-cad) | `@voxel-craft-cad generate a spiral tower in voxels` |
| Calculating Minecraft survival crafting stacks (64-item math) and chest layouts? | [`mcfunction-builder`](#skill-mcfunction-builder) | `@mcfunction-builder calculate pyramid stacks` |

### Detailed Breakdown of Skills in Creative, Media, Gaming & 3D

<a id="skill-algorithmic-art"></a>
#### `algorithmic-art` — Generative & Algorithmic Art (p5.js)
- **Source Folder:** [algorithmic-art](../config/skills/algorithmic-art)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Creates interactive generative art, flow fields, particle simulations, and geometric patterns using p5.js and canvas code.
- **When to Use:** When creating creative coding projects, generative backgrounds, or interactive math visualizers.
- **Example Prompt:**
  ```text
  @algorithmic-art create an interactive flow field particle simulation in p5.js
  ```

<a id="skill-ffmpeg"></a>
#### `ffmpeg` — Local Video & Audio Editing (FFmpeg)
- **Source Folder:** [ffmpeg](../config/skills/ffmpeg)
- **Upstream Repository:** [kajisho5/ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill) (MIT)
- **What It Does:** 40+ deterministic Python scripts around local FFmpeg: cut, join, reframe/fit, speed, captions, overlays, silence removal, sync, loudness, HDR to SDR, platform exports and checks. Needs FFmpeg 6.1+ and Python 3.10+; no cloud, no pip packages.
- **When to Use:** When you already have a video or audio file and want it edited or checked. For a brand-new clip from a text prompt use `video-gen`.
- **How it stays reliable on small models:** run the script with `--dry-run` first (prints the exact ffmpeg command, writes nothing), then for real, then verify with `scripts/probe.py` / `scripts/verify.py`.
- **Most-used commands:**
  ```bash
  python3 ~/.config/opencode/skills/ffmpeg/scripts/probe.py clip.mp4
  python3 ~/.config/opencode/skills/ffmpeg/scripts/cut.py clip.mp4 --start 5 --duration 15 -o out.mp4 --dry-run
  python3 ~/.config/opencode/skills/ffmpeg/scripts/render.py --list-templates
  ```
- **Example Prompt:**
  ```text
  @ffmpeg cut clip.mp4 from 0:05 to 0:20 and export it for TikTok
  ```

<a id="skill-line-art-animation"></a>
#### `line-art-animation` — Animated Line-Art SVG Components
- **Source Folder:** [line-art-animation](../config/skills/line-art-animation)
- **Upstream Repository:** [JDhruv14/line-art-animation](https://github.com/JDhruv14/line-art-animation) (MIT)
- **What It Does:** Thin-pen line-art scenes in SVG + TypeScript: people and animals that walk and react with a real gait solver (planted feet, no sliding), springs for scarves and lanterns, wind from the pointer, and a day/night palette. Exports deterministic video frame by frame through headless Chrome/Brave + ffmpeg.
- **When To Use It:** an animated illustration, doodle or ink scene for a page, or a short line-art video.
- **How it stays reliable on small models:** a `?debug` mode steps time exactly, so frames can be checked one by one; `scripts/capture.ts` finds Chrome or Brave by itself.
- **Example Prompt:**
  ```text
  @line-art-animation a hand-drawn delivery rider cycling past a row of shops, as a 10 s video
  ```

<a id="skill-godot4-dev"></a>
#### `godot4-dev` — Godot 4 Game Engine & GDScript 2.0
- **Source Folder:** [godot4-dev](../config/skills/godot4-dev)
- **Upstream Repository:** [godotengine/godot](https://github.com/godotengine/godot)
- **What It Does:** Engineering guidelines and best practices for Godot 4: GDScript 2.0 static typing, scene hierarchy, state machines, physics, and shader code.
- **When to Use:** When developing 2D or 3D games, mechanics, or UI inside the Godot 4 engine.
- **Example Prompt:**
  ```text
  @godot4-dev create a character controller script with double-jump in GDScript
  ```

<a id="skill-image-gen"></a>
#### `image-gen` — AI Image Generation via Free Backends
- **Source Folder:** [image-gen](../config/skills/image-gen)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Generates images from text prompts using available free backend providers (e.g., OVH AI, Pollinations, HuggingFace Flux/SD).
- **When to Use:** When you need an image, avatar, illustration, or visual asset generated from a prompt.
- **Example Prompt:**
  ```text
  @image-gen generate an illustration of a cozy cyberpunk coffee shop
  ```

<a id="skill-mcfunction-builder"></a>
#### `mcfunction-builder` — Minecraft Inventory & Survival Math Calculator
- **Source Folder:** [mcfunction-builder](../config/skills/mcfunction-builder)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Calculates Minecraft survival crafting stacks (64-item base stacks + remainders), chest layout math, and resource gathering quantities.
- **When to Use:** When planning large Minecraft survival construction projects and calculating required stacks.
- **Example Prompt:**
  ```text
  @mcfunction-builder calculate how many shulker boxes of cobblestone are needed for a 50x50 pyramid
  ```

<a id="skill-video-gen"></a>
#### `video-gen` — AI Video Clip Generator
- **Source Folder:** [video-gen](../config/skills/video-gen)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Generates short animated video clips from text prompts: tier 1 Google Veo and tier 2 SeaDance through OmniRoute, tier 3 Hugging Face LTX-Video when a `generate-video` command is installed. Every tier's file is checked with ffprobe (a video stream and a length above zero) before it counts.
- **When to Use:** When you need a short motion clip or visual video asset.
- **Example Prompt:**
  ```text
  @video-gen generate a 5-second video of ocean waves crashing at sunset
  ```

<a id="skill-voxel-craft-cad"></a>
#### `voxel-craft-cad` — Procedural Voxel Generation & 3D CAD Modeling
- **Source Folder:** [voxel-craft-cad](../config/skills/voxel-craft-cad)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Writes parametric math code to generate procedural 3D voxel structures, architectural blueprints, and voxel models.
- **When to Use:** When building procedural voxel worlds, 3D structures, or algorithmic building generators.
- **Example Prompt:**
  ```text
  @voxel-craft-cad generate a procedural spiral castle tower in voxels
  ```

---

<a id="system-desktop-browser-tooling"></a>
## 12. System, Desktop, Browser & Tooling

*Linux desktop control, browser automation, knowledge graphs, MCP builders, and memory tools.*

### 🧭 Which One Should I Pick? (Decision Guide)

| If your goal is... | Choose this skill | Copy-Paste Example Prompt |
| :--- | :--- | :--- |
| Operating the Linux desktop (capturing screen, clicking buttons, moving windows)? | [`desktop-control`](#skill-desktop-control) | `@desktop-control inspect the active desktop window` |
| Controlling a real desktop browser (Chrome/Brave/Edge) with OpenCode Browse? | [`browser-automation`](#skill-browser-automation) | `@browser-automation test our staging login flow` |
| Mapping an entire codebase into a searchable graph of functions and calls? | [`graphify`](#skill-graphify) | `@graphify build a knowledge graph of this repo` |
| Building a custom Model Context Protocol (MCP) server for AI tools? | [`mcp-builder`](#skill-mcp-builder) | `@mcp-builder build a Python MCP server` |
| Importing saved chat memories from ChatGPT, Claude, or Gemini into local memory? | [`memory-import`](#skill-memory-import) | `@memory-import import memories from memories.json` |
| Discovering and installing new agent skills from online repositories? | [`find-skills`](#skill-find-skills) | `@find-skills search for Rust skills` |
| Creating or scaffolding brand new custom skills for OpenCode? | [`skill-creator`](#skill-skill-creator) | `@skill-creator scaffold a new skill` |
| Auditing how many tokens your system prompt and active tools consume? | [`context-budget`](#skill-context-budget) | `@context-budget audit token consumption` |
| Preventing the model from truncating or cutting off large output files? | [`output-skill`](#skill-output-skill) | `@output-skill ensure the full file is printed` |

### Detailed Breakdown of Skills in System, Desktop, Browser & Tooling

<a id="skill-browser-automation"></a>
#### `browser-automation` — Real Browser Driving & Automation (OpenCode Browse)
- **Source Folder:** [browser-automation](../config/skills/browser-automation)
- **Upstream Repository:** [anomalyco/browse](https://github.com/anomalyco/browse)
- **What It Does:** Drives the user's real desktop browser (Chrome, Brave, Edge, Opera, Arc) via the official OpenCode Browse extension and MCP relay: navigates pages, reads compact accessibility snapshots with element refs, clicks, fills forms, executes Playwright scripts, and hands off CAPTCHAs/2FA.
- **When to Use:** When automating web workflows, testing sites with logged-in sessions, reading web content with interactive refs, or completing multi-step forms.
- **Most Commonly Used Commands:**
  ```text
  navigate <url>                           # Open a URL in a connected browser tab
  snapshot                                 # Return compact text outline with element refs (e1, e2...)
  click <ref>                              # Click element matching ref (e.g. e1)
  fill <ref> "<value>"                     # Fill text input or textarea
  handoff                                  # Prompt user to solve CAPTCHA/2FA and resume
  execute "<js>"                           # Execute Playwright-style script on page
  ```
- **Example Prompt:**
  ```text
  @browser-automation open our staging site and verify the login flow
  ```

<a id="skill-context-budget"></a>
#### `context-budget` — OpenCode Context Overhead & Token Auditor
- **Source Folder:** [context-budget](../config/skills/context-budget)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Audits token overhead consumed by system prompts, AGENTS.md, active skills, tools, and commands, providing optimization tips for smaller models.
- **When to Use:** When tuning your setup for low-context free models and checking where your token budget is spent.
- **Example Prompt:**
  ```text
  @context-budget audit our active configuration and report token consumption
  ```

<a id="skill-desktop-control"></a>
#### `desktop-control` — Linux Desktop Automation (Wayland/Hyprland)
- **Source Folder:** [desktop-control](../config/skills/desktop-control)
- **Upstream Repository:** [anthropics/anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts)
- **What It Does:** Inspects and operates the Linux desktop: captures screen regions, manipulates windows (Hyprland/Wayland), clicks buttons, and types keys.
- **When to Use:** When you want the AI to interact directly with desktop GUI applications on your Linux desktop.
- **Most Commonly Used Commands:**
  ```text
  screenshot                               # Capture desktop screen state
  click <x> <y>                            # Click at specific screen coordinates
  type "<text>"                            # Send keystrokes to the focused window
  key <combination>                        # Press hotkeys (e.g. Super+Return, Alt+Tab)
  ```
- **Example Prompt:**
  ```text
  @desktop-control take a screenshot of the active window and inspect its UI
  ```

<a id="skill-find-skills"></a>
#### `find-skills` — Skill Discovery & Online Installer
- **Source Folder:** [find-skills](../config/skills/find-skills)
- **Upstream Repository:** [agentskills/agentskills](https://github.com/agentskills/agentskills)
- **What It Does:** Discovers and installs new agent skills from online repositories (skills.sh, GitHub) matching tasks you want to accomplish.
- **When to Use:** When you need a specialized capability that isn't currently installed and want to search for community skills.
- **Most Commonly Used Commands:**
  ```bash
  find-skills search "<topic>"             # Search online GitHub repositories for agent skills
  find-skills inspect <repo/skill>         # View skill contents and security score before installing
  find-skills install <repo/skill>         # Download and register skill into local OpenCode config
  ```
- **Example Prompt:**
  ```text
  @find-skills search for skills related to Rust web development
  ```

<a id="skill-graphify"></a>
#### `graphify` — Codebase Knowledge Graph & Architecture Map
- **Source Folder:** [graphify](../config/skills/graphify)
- **Upstream Repository:** [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)
- **Execution Mode:** On-Demand Skill (`/graphify`) — *Operated strictly on-demand (not as a background MCP server) to eliminate context window token schema bloat, multi-project locking, and port conflicts.*
- **What It Does:** Converts an entire codebase into a persistent knowledge graph mapping all functions, classes, imports, and calls for fast architectural queries.
- **When to Use:** When exploring a project and you need to query caller/callee graphs, dependency paths, or architectural hub nodes.
- **Most Commonly Used Commands:**
  ```bash
  /graphify .                              # Build knowledge graph for the current repository
  /graphify query "<question>"             # Broad architectural query using BFS graph traversal
  /graphify path "<Source>" "<Target>"     # Find shortest dependency/call path between two components
  /graphify explain "<Node>"               # Plain-language breakdown of a class/function/module
  /graphify --update                       # Incrementally re-index only newly created or modified files
  /graphify <path>                         # Build knowledge graph for a specific subfolder or project
  ```
- **Example Prompt:**
  ```text
  @graphify trace the shortest path between "AuthService" and "DatabasePool"
  ```

<a id="skill-mcp-builder"></a>
#### `mcp-builder` — Model Context Protocol (MCP) Server Builder
- **Source Folder:** [mcp-builder](../config/skills/mcp-builder)
- **Upstream Repository:** [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- **What It Does:** Guides the creation of robust, standard-compliant Model Context Protocol (MCP) servers (Python/Node.js) to give AI agents custom tools and resources.
- **When to Use:** When developing a new MCP server or tool integration to connect external services to OpenCode.
- **Most Commonly Used Commands:**
  ```bash
  mcp-builder init python                  # Scaffold FastMCP Python server with standard schema
  mcp-builder init typescript              # Scaffold Node.js / TypeScript MCP server
  mcp-builder test                         # Run automated compliance check against local MCP server
  ```
- **Example Prompt:**
  ```text
  @mcp-builder build a Python MCP server that provides weather tools
  ```

<a id="skill-memory-import"></a>
#### `memory-import` — AI Assistant Memory & History Importer
- **Source Folder:** [memory-import](../config/skills/memory-import)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Imports exported memories and chat histories from ChatGPT, Claude, or Gemini into OpenCode's local long-term memory engine.
- **When to Use:** When migrating to OpenCode from another assistant and you want to bring over your personal preferences and context.
- **Example Prompt:**
  ```text
  @memory-import import my exported ChatGPT memories from memories.json
  ```

<a id="skill-output-skill"></a>
#### `output-skill` — LLM Truncation Override & Long Output Handler
- **Source Folder:** [output-skill](../config/skills/output-skill)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Overrides default model truncation behavior when generating massive code files or lengthy reports to ensure nothing gets cut off.
- **When to Use:** When requesting very large outputs and you want to prevent the model from stopping halfway or truncating code.
- **Example Prompt:**
  ```text
  @output-skill ensure the full 500-line configuration file is output without truncation
  ```

<a id="skill-skill-creator"></a>
#### `skill-creator` — New Skill Authoring & Benchmarking Kit
- **Source Folder:** [skill-creator](../config/skills/skill-creator)
- **Upstream Repository:** [anthropics/skills](https://github.com/anthropics/skills)
- **What It Does:** Guides creating new SKILL.md packages, structuring tools and scripts, writing clear triggers, and benchmarking skill performance.
- **When to Use:** When building a brand new custom skill for OpenCode to automate a recurring workflow.
- **Example Prompt:**
  ```text
  @skill-creator scaffold a new skill for managing local Kubernetes clusters
  ```

---

## Alphabetical Index of All 91 Skills

| Skill | Category | Quick Purpose |
| :--- | :--- | :--- |
| [`academic-paper`](#skill-academic-paper) | [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) | Full academic manuscript writing assistant supporting 11 modes (literature reviews, outlines, drafts, citations, LaTeX/Pandoc formatting).. |
| [`academic-paper-reviewer`](#skill-academic-paper-reviewer) | [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) | Simulates a rigorous 5-seat journal peer review panel (Journal-Fit Reviewer + 3 domain experts + Devil's Advocate) providing actionable critiques.. |
| [`academic-pipeline`](#skill-academic-pipeline) | [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) | Orchestrates the entire academic journey: literature search, paper drafting, integrity/citation checks, peer review simulation, and revision.. |
| [`agentskills`](#skill-agentskills) | [Autonomous Multi-Agent & Orchestration](#autonomous-multi-agent-orchestration) | Orchestrates the software development lifecycle: detects whether you are Planning, Coding, Testing, or Releasing and applies the right disciplined workflow.. |
| [`algorithmic-art`](#skill-algorithmic-art) | [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) | Creates interactive generative art, flow fields, particle simulations, and geometric patterns using p5.js and canvas code.. |
| [`anti-sycophancy`](#skill-anti-sycophancy) | [Code Review, Auditing & Security](#code-review-auditing-security) | Forces the assistant to remain rigorously truthful, challenging flawed assumptions, false claims, and invalid logic instead of politely agreeing.. |
| [`benchmark-checklist`](#skill-benchmark-checklist) | [Testing, Verification & Debugging](#testing-verification-debugging) | Vets performance measurements against systematic criteria: warm-up runs, system limits, measurement noise, and statistical significance.. |
| [`blast-radius`](#skill-blast-radius) | [Code Review, Auditing & Security](#code-review-auditing-security) | Calculates downstream dependencies and side effects of a code change to reveal what elsewhere could break before you ship.. |
| [`brainstorming`](#skill-brainstorming) | [Autonomous Multi-Agent & Orchestration](#autonomous-multi-agent-orchestration) | Facilitates structured brainstorming: explores multiple technical approaches, weighs pros and cons, and clarifies requirements before deciding.. |
| [`browser-automation`](#skill-browser-automation) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Drives the user's real desktop browser via the OpenCode Browse extension with saved logins and CAPTCHA hand-off.. |
| [`canvas-design`](#skill-canvas-design) | [Document, Office & Content Creation](#document-office-content-creation) | Generates visual artwork, posters, infographics, and book covers rendered into high-resolution PNG or PDF files.. |
| [`chisle`](#skill-chisle) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | A hyper-efficient, minimal-overhead development and audit mode designed to execute changes cleanly with the least tokens possible.. |
| [`code-review`](#skill-code-review) | [Code Review, Auditing & Security](#code-review-auditing-security) | Conducts thorough code reviews examining correctness, security vulnerabilities, edge cases, maintainability, and code style.. |
| [`codebase-design`](#skill-codebase-design) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Guides the design of deep classes and modules (simple public interfaces hiding powerful internal complexity) based on clean architecture principles.. |
| [`codebase-onboarding`](#skill-codebase-onboarding) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Scans an unfamiliar codebase, maps its architecture, entry points, data flows, and key abstractions, and writes a clear developer onboarding guide.. |
| [`context-budget`](#skill-context-budget) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Audits token overhead consumed by system prompts, AGENTS.md, active skills, tools, and commands, providing optimization tips for smaller models.. |
| [`correct`](#skill-correct) | [Testing, Verification & Debugging](#testing-verification-debugging) | Analyzes recurring coding or configuration errors made by AI agents in your repository and encodes preventative rules so they never happen again.. |
| [`create-design-md`](#skill-create-design-md) | [Web, Frontend & UI/UX Design](#web-frontend-ui-ux-design) | Inspects an existing website or code repository and generates a comprehensive DESIGN.md documenting its typography, colors, spacing, and components.. |
| [`data-analyze`](#skill-data-analyze) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Conducts complete data analyses from raw CSV/database records: data cleaning, summarization, trend detection, and answering business questions.. |
| [`data-build-dashboard`](#skill-data-build-dashboard) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Builds interactive, self-contained HTML dashboards containing charts, date range filters, KPI cards, and sortable data tables.. |
| [`data-context-extractor`](#skill-data-context-extractor) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Extracts organizational tribal knowledge, table definitions, and business logic from analysts into a reusable domain skill.. |
| [`data-create-viz`](#skill-data-create-viz) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Quickly generates focused charts and plots for data exploration and reporting with minimal code.. |
| [`data-explore-data`](#skill-data-explore-data) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Profiles raw datasets to inspect shapes, null values, distributions, anomalies, data types, and correlation structures.. |
| [`data-science-tutor`](#skill-data-science-tutor) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | An interactive tutor that explains machine learning, math, and data science concepts in simple, intuitive terms with practical examples.. |
| [`data-sql-queries`](#skill-data-sql-queries) | [Database, Backend & Cloud](#database-backend-cloud) | Writes accurate, high-performance SQL queries across major database engines (PostgreSQL, MySQL, SQLite, Snowflake, BigQuery, DuckDB).. |
| [`data-statistical-analysis`](#skill-data-statistical-analysis) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Applies classical and modern statistical methods: hypothesis testing (t-tests, chi-square), ANOVA, regression models, and confidence intervals.. |
| [`data-validate-data`](#skill-data-validate-data) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Audits data conclusions and methodologies before sharing: checks for sampling bias, survivorship bias, metric calculation errors, and outliers.. |
| [`data-visualization`](#skill-data-visualization) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Builds clear, publication-ready charts and graphs in Python with proper labels, legible axes, clean color scales, and high DPI.. |
| [`data-write-query`](#skill-data-write-query) | [Database, Backend & Cloud](#database-backend-cloud) | Diagnoses slow SQL queries using query execution plans (EXPLAIN ANALYZE), missing indexes, and query restructuring.. |
| [`database-migrations`](#skill-database-migrations) | [Database, Backend & Cloud](#database-backend-cloud) | Designs safe, non-locking database migrations with zero downtime, proper rollback scripts, column defaults, and index creation.. |
| [`deep-research`](#skill-deep-research) | [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) | Executes thorough, exhaustive research on complex topics, cross-referencing multiple authoritative sources to produce a structured dossier.. |
| [`deployment-patterns`](#skill-deployment-patterns) | [Git, DevOps, Containers & Deployment](#git-devops-containers-deployment) | Configures end-to-end deployment workflows: GitHub Actions, automated testing pipelines, Docker publishing, and blue/green deployments.. |
| [`design-quality`](#skill-design-quality) | [Web, Frontend & UI/UX Design](#web-frontend-ui-ux-design) | Audits, critiques, and refines visual components, UI layouts, color palettes, and typography to eliminate amateurish design flaws.. |
| [`desktop-control`](#skill-desktop-control) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Inspects and operates the Linux desktop: captures screen regions, manipulates windows (Hyprland/Wayland), clicks buttons, and types keys.. |
| [`deslop`](#skill-deslop) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Cleans up repetitive, overly verbose, or hallucinated AI boilerplate, restoring idiomatic patterns and concise, clean coding style.. |
| [`docker-infra`](#skill-docker-infra) | [Git, DevOps, Containers & Deployment](#git-devops-containers-deployment) | Creates and optimizes production-ready Dockerfiles, multi-stage builds, docker-compose.yml files, and health checks with minimal image size.. |
| [`documentation-lookup`](#skill-documentation-lookup) | [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) | Fetches current, up-to-date documentation for libraries, frameworks, and APIs directly instead of relying on outdated training memory.. |
| [`docx`](#skill-docx) | [Document, Office & Content Creation](#document-office-content-creation) | Creates, formats, reads, and updates Microsoft Word (.docx) documents with clean typography, styled headings, tables, callout boxes, and headers/footers.. |
| [`dual-viewport-ui`](#skill-dual-viewport-ui) | [Web, Frontend & UI/UX Design](#web-frontend-ui-ux-design) | Architects synchronized dual-pane web interfaces that combine an interactive 3D WebGL scene with a reactive 2D parameter control panel.. |
| [`engineering-principles`](#skill-engineering-principles) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Enforces pragmatic software craftsmanship: subtract unnecessary code before adding, fix root causes, avoid over-engineering, and keep codebase lean.. |
| [`experiment-and-inference`](#skill-experiment-and-inference) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Designs controlled experiments and A/B tests: sample size calculations, power analysis, randomization, and causal effect estimation.. |
| [`ffmpeg`](#skill-ffmpeg) | [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) | Edits existing video and audio locally with FFmpeg scripts (cut, captions, reframe, loudness, exports), dry-run first and verified after. |
| [`find-skills`](#skill-find-skills) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Discovers and installs new agent skills from online repositories (skills.sh, GitHub) matching tasks you want to accomplish.. |
| [`frontend-design`](#skill-frontend-design) | [Web, Frontend & UI/UX Design](#web-frontend-ui-ux-design) | Helps create visually distinctive, polished, and personality-driven web interfaces with cohesive color schemes, micro-interactions, and typography.. |
| [`geo-sleuth`](#skill-geo-sleuth) | [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) | Geolocates or chronolocates photos using tool-verified evidence: camera metadata (EXIF), landmarks, sun shadow math, street view, and OCR signs.. |
| [`git-conflict-resolver`](#skill-git-conflict-resolver) | [Git, DevOps, Containers & Deployment](#git-devops-containers-deployment) | Resolves complex git merge conflicts, rebase collisions, and detached HEAD states systematically without losing code changes.. |
| [`git-workflow`](#skill-git-workflow) | [Git, DevOps, Containers & Deployment](#git-devops-containers-deployment) | Guides clean Git practices: conventional commit messages, feature branch workflows, PR templates, and maintaining clean git history.. |
| [`godot4-dev`](#skill-godot4-dev) | [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) | Engineering guidelines and best practices for Godot 4: GDScript 2.0 static typing, scene hierarchy, state machines, physics, and shader code.. |
| [`graphify`](#skill-graphify) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Converts an entire codebase into a persistent knowledge graph mapping all functions, classes, imports, and calls for fast architectural queries.. |
| [`image-gen`](#skill-image-gen) | [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) | Generates images from text prompts using available free backend providers (e.g., OVH AI, Pollinations, HuggingFace Flux/SD).. |
| [`line-art-animation`](#skill-line-art-animation) | [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) | Animated thin-pen line-art SVG scenes (walking figures, wind, day/night) with deterministic video export. |
| [`markitdown`](#skill-markitdown) | [Document, Office & Content Creation](#document-office-content-creation) | Converts virtually any document or media format (PDF, Word, PPTX, Excel, HTML, CSV, audio, images, ZIP) into clean, readable Markdown.. |
| [`mcfunction-builder`](#skill-mcfunction-builder) | [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) | Calculates Minecraft survival crafting stacks (64-item base stacks + remainders), chest layout math, and resource gathering quantities.. |
| [`mcp-builder`](#skill-mcp-builder) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Guides the creation of robust, standard-compliant Model Context Protocol (MCP) servers (Python/Node.js) to give AI agents custom tools and resources.. |
| [`memory-import`](#skill-memory-import) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Imports exported memories and chat histories from ChatGPT, Claude, or Gemini into OpenCode's local long-term memory engine.. |
| [`ml-workflow`](#skill-ml-workflow) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Guides sound machine learning workflows: feature engineering, train/validation/test splits, cross-validation, hyperparameter tuning, and metric evaluation.. |
| [`modern-web-guidance`](#skill-modern-web-guidance) | [Web, Frontend & UI/UX Design](#web-frontend-ui-ux-design) | Provides cutting-edge standards for HTML, CSS, and modern browser APIs (dialogs, popovers, view transitions, container queries, :has selectors).. |
| [`no-comments`](#skill-no-comments) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Finds and deletes redundant, obvious, or noisy comments that state what code clearly does, keeping only indispensable architectural explanations.. |
| [`output-skill`](#skill-output-skill) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Overrides default model truncation behavior when generating massive code files or lengthy reports to ensure nothing gets cut off.. |
| [`owasp-security`](#skill-owasp-security) | [Code Review, Auditing & Security](#code-review-auditing-security) | Audits application code against OWASP Top 10 vulnerabilities: injection, broken authentication, sensitive data exposure, and security misconfigurations.. |
| [`pdf`](#skill-pdf) | [Document, Office & Content Creation](#document-office-content-creation) | Inspects PDF documents, extracts text and tables, merges or splits pages, fills forms, and renders visual previews of pages.. |
| [`performance-profiling`](#skill-performance-profiling) | [Testing, Verification & Debugging](#testing-verification-debugging) | Diagnoses CPU hotspots, memory leaks, event loop delays, and unoptimized I/O loops using profilers and flamegraphs.. |
| [`plans`](#skill-plans) | [Autonomous Multi-Agent & Orchestration](#autonomous-multi-agent-orchestration) | Drafts structured, phased implementation plans before writing any code: outlines architectural decisions, risks, steps, and verification criteria.. |
| [`ponytail`](#skill-ponytail) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Forces the simplest, laziest working solution: standard library first, zero extra dependencies, native platform features, and one line before fifty.. |
| [`ponytail-debt`](#skill-ponytail-debt) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Scans the codebase for deliberate shortcuts (e.g., `# ponytail:` comments) and compiles them into a prioritized technical debt roadmap.. |
| [`portfolio-project-builder`](#skill-portfolio-project-builder) | [Data Science, Analytics & Visualizations](#data-science-analytics-visualizations) | Helps build end-to-end, interview-ready data science and analytics portfolio projects with clean code, READMEs, and executive summaries.. |
| [`pptx`](#skill-pptx) | [Document, Office & Content Creation](#document-office-content-creation) | Designs high-quality PowerPoint slide decks (.pptx) from scratch or edits existing presentations with consistent color palettes, visual hierarchies, and modern layouts.. |
| [`production-hardening`](#skill-production-hardening) | [Git, DevOps, Containers & Deployment](#git-devops-containers-deployment) | Audits applications before production launch: configuring crash recovery, rate limiting, secure HTTP headers, timeouts, and error handling.. |
| [`publishing-release`](#skill-publishing-release) | [Git, DevOps, Containers & Deployment](#git-devops-containers-deployment) | Automates the release process: version bumping (SemVer), changelog generation from git commits, git tagging, and package publishing.. |
| [`rea`](#skill-rea) | [Autonomous Multi-Agent & Orchestration](#autonomous-multi-agent-orchestration) | Runs automated evaluations, test suites, and capability verification benchmarks via the REA CLI tool.. |
| [`ruflo`](#skill-ruflo) | [Autonomous Multi-Agent & Orchestration](#autonomous-multi-agent-orchestration) | Invokes the Ruflo multi-agent CLI system to coordinate agent teams for complex parallel tasks.. |
| [`schema-to-type`](#skill-schema-to-type) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Converts raw JSON data, OpenAPI specifications, or database schemas into type-safe code structures (TypeScript interfaces, Zod schemas, or Pydantic models).. |
| [`sharpen`](#skill-sharpen) | [Autonomous Multi-Agent & Orchestration](#autonomous-multi-agent-orchestration) | Takes vague or broad prompts and sharpens them into concrete, actionable, deeply detailed specifications with defined boundaries.. |
| [`skill-creator`](#skill-skill-creator) | [System, Desktop, Browser & Tooling](#system-desktop-browser-tooling) | Guides creating new SKILL.md packages, structuring tools and scripts, writing clear triggers, and benchmarking skill performance.. |
| [`sr-screener`](#skill-sr-screener) | [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) | Screen scientific studies and papers against strict inclusion/exclusion criteria according to PRISMA protocols for systematic reviews.. |
| [`subagent-driven-development`](#skill-subagent-driven-development) | [Autonomous Multi-Agent & Orchestration](#autonomous-multi-agent-orchestration) | Takes an implementation plan and executes it by dispatching focused, independent subagents for each subtask with strict verification gates.. |
| [`supabase`](#skill-supabase) | [Database, Backend & Cloud](#database-backend-cloud) | Comprehensive guide for Supabase: PostgreSQL database, Auth, Row-Level Security (RLS) policies, Realtime, Storage, and Edge Functions.. |
| [`systematic-debugging`](#skill-systematic-debugging) | [Testing, Verification & Debugging](#testing-verification-debugging) | Enforces disciplined debugging: reproduce the issue first, form testable hypotheses, isolate root cause, and verify fixes before writing code.. |
| [`test-quality`](#skill-test-quality) | [Testing, Verification & Debugging](#testing-verification-debugging) | Designs and writes high-coverage unit, integration, and end-to-end tests with realistic edge cases, clean fixtures, and proper mocking.. |
| [`thermo-nuclear-code-quality-review`](#skill-thermo-nuclear-code-quality-review) | [Code Review, Auditing & Security](#code-review-auditing-security) | A ruthless code maintainability review hunting down oversized files, abstraction sprawl, god objects, and unneeded complexity.. |
| [`thermo-nuclear-review`](#skill-thermo-nuclear-review) | [Code Review, Auditing & Security](#code-review-auditing-security) | An exhaustive, uncompromising audit of git branch diffs looking for hidden race conditions, auth bypasses, resource leaks, and data hazards.. |
| [`thermos`](#skill-thermos) | [Code Review, Auditing & Security](#code-review-auditing-security) | Runs both thermo-nuclear security and code-quality reviews in parallel, synthesizing their findings into a single prioritized report.. |
| [`typescript-best-practices`](#skill-typescript-best-practices) | [Software Architecture, Coding & Refactoring](#software-architecture-coding-refactoring) | Enforces strict, idiomatic TypeScript practices: eliminating 'any', proper discriminated unions, type narrowing, and sound async error handling.. |
| [`using-git-worktrees`](#skill-using-git-worktrees) | [Git, DevOps, Containers & Deployment](#git-devops-containers-deployment) | Sets up and manages Git worktrees to work on multiple branches simultaneously in isolated directories without stashing or switching branches.. |
| [`verification-before-completion`](#skill-verification-before-completion) | [Testing, Verification & Debugging](#testing-verification-debugging) | Requires running tests, linters, or build commands and verifying positive output before asserting that a task is finished or working.. |
| [`video-gen`](#skill-video-gen) | [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) | Generates short animated video clips from text prompts using tiered video generation models in OmniRoute.. |
| [`voxel-craft-cad`](#skill-voxel-craft-cad) | [Creative, Media, Gaming & 3D](#creative-media-gaming-3d) | Writes parametric math code to generate procedural 3D voxel structures, architectural blueprints, and voxel models.. |
| [`web-artifacts-builder`](#skill-web-artifacts-builder) | [Web, Frontend & UI/UX Design](#web-frontend-ui-ux-design) | Builds standalone, self-contained single-page HTML/JS applications, calculators, visualizers, and interactive prototypes that run directly in any browser.. |
| [`web-design-guidelines`](#skill-web-design-guidelines) | [Web, Frontend & UI/UX Design](#web-frontend-ui-ux-design) | Audits website code against official Web Interface Guidelines, checking accessibility (contrast, keyboard focus, screen readers) and UX design standards.. |
| [`web-research`](#skill-web-research) | [Web Research, Academic & Document Intelligence](#web-research-academic-document-intelligence) | Searches the web across multiple sources, extracts key facts, and compiles concise, cited summaries with direct source URLs.. |
| [`xlsx`](#skill-xlsx) | [Document, Office & Content Creation](#document-office-content-creation) | Builds and audits Excel spreadsheets (.xlsx) with clean formulas, formatted headers, zebra striping, currency/date number formatting, and multi-sheet workbooks.. |
