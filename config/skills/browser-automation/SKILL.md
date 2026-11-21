---
name: browser-automation
description: "Automate and drive the user's real browser (Chrome, Brave, Edge, Opera, Arc) through the official OpenCode Browse MCP server and browser extension: open tabs, navigate, read compact accessibility snapshots with element refs, click, fill forms, execute Playwright scripts, take screenshots, inspect console/network, and seamlessly hand off CAPTCHAs/2FA to the user."
---

# Browser automation

OpenCode Zenith drives the user's real, everyday desktop browser through the official **OpenCode Browse** extension and local relay (`browse` MCP server on `127.0.0.1:19988`).

This gives the agent:
- Direct access to active sessions, saved logins, and cookies without starting clean incognito profiles.
- Native interactive hand-off (`tools.browse.handoff`) for CAPTCHA/Turnstile verification and 2FA.
- Full Playwright-style script execution (`tools.browse.execute`).
- Zero port conflicts or browser restart requirements.

---

## Extension & Relay Pairing

1. **Check Connection**:
   Before running browser actions, check `tools.browse.status({})` to verify connected browsers and active tabs.
2. **Browser Compatibility**:
   - **Chrome / Chromium**: Native 1-click install from Chrome Web Store.
   - **Brave**: Native 1-click install from Chrome Web Store.
   - **Microsoft Edge**: Click "Allow extensions from other stores", then "Add to Edge".
   - **Opera / Vivaldi / Arc**: Direct Chrome Web Store support.
   - **Extension URL**: `https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg`
   - If not connected, prompt the user to install the extension and click the extension icon once.

---

## Core Tool Reference

| Task | Tool Call | Description |
|---|---|---|
| Open / Navigate | `tools.browse.navigate({ url })` | Opens a URL in a new or existing tab and returns the `tab` ID. |
| Read Page | `tools.browse.snapshot({ tab })` | Returns a compact text outline of interactive elements with refs (`e1`, `e2`, etc.). |
| Click | `tools.browse.click({ target: "e1", tab })` | Clicks the element matching the ref from the snapshot. |
| Fill Form | `tools.browse.fill({ target: "e2", text: "value", tab })` | Fills an input, textarea, or contenteditable. |
| Key Press | `tools.browse.press({ key: "Enter", tab })` | Sends keyboard shortcut or key to focused element. |
| Select Option | `tools.browse.select({ target: "e3", value: "opt", tab })` | Selects option from dropdown. |
| Wait For | `tools.browse.wait_for({ text: "Success", tab })` | Waits for text, selector, or URL pattern to settle. |
| Human Handoff | `tools.browse.handoff({ tab, reason: "Please solve CAPTCHA" })` | Pauses and asks user to complete 2FA/CAPTCHA in the visible tab. |
| Run Script | `tools.browse.execute({ code: "await page.click('button')" })` | Executes Playwright-style JS on `page` in the browser tab. |
| Screenshot | `tools.browse.screenshot({ tab, fullPage: false })` | Captures image of the viewport or element. |
| Manage Tabs | `tools.browse.tabs({ action: "list" / "close" / "new" })` | Lists or closes agent tabs. |

---

## Workflow: Accessibility Snapshots First

Screenshots cost thousands of tokens and hide actionable element references. Always default to the accessibility snapshot:

1. `navigate` to the URL.
2. `snapshot` to retrieve interactive element refs (`e1`, `e2`, ...).
3. Act on refs using `click`, `fill`, or `select`.
4. Re-snapshot to verify the state change (URL updated, error resolved, submission succeeded).

Use `screenshot` only when visual layout, CSS styling, or charts are the explicit subject of analysis.

---

## Human Handoff (`handoff`)

When a site presents a CAPTCHA, Cloudflare Turnstile, multi-factor authentication (2FA/SMS), or payment confirmation:
- **Never guess or loop endlessly on bot challenges.**
- Invoke `tools.browse.handoff({ reason: "Please complete the Cloudflare verification" })`.
- OpenCode will notify the user to perform the action in their open browser tab, then automatically resume execution once completed.

---

## Tab Safety & Etiquette

- **Never navigate away from or close the user's personal tabs.** The browser is signed into the user's real accounts.
- Always perform work in agent tabs opened via `navigate` or `tabs(action: "new")`.
- When the task finishes, close only the tabs you opened (`tools.browse.tabs({ action: "close", tab: id })`).
