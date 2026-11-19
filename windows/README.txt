OpenCode setup for Windows 10 / 11
==================================

What this installs
------------------
- OpenCode (the AI coding assistant for the terminal), plus Git, Node.js,
  Python, ripgrep and fd if they are missing (via winget, Windows may ask
  for permission).
- A ready-made OpenCode configuration: rules, specialised agents, slash
  commands, a large skill library, a skill router (picks the right skill for
  each prompt automatically) and an auto-failover plugin (switches to the
  next model when one fails or hits its limit).
- Automatic model ranking: every day at 04:00 (or as soon as the PC is on
  after that) a short benchmark tests the free models and ranks them for
  each kind of task. A small background helper moves back to the better
  model when it recovers.
- OmniRoute, a local AI gateway on http://localhost:20128, used as a
  fallback when the free OpenCode models run out.

No API keys or accounts are included. You add your own during setup.

How to install
--------------
1. Right-click the zip > Extract All. Do not run it from inside the zip.
2. Open the extracted folder and double-click install.bat.
3. Answer the questions:
   - OmniRoute admin password (you choose it, at least 8 characters)
   - OpenRouter API key: optional, free at https://openrouter.ai/keys
   - OmniRoute API key: the dashboard opens in your browser. Log in, optionally
     add AI accounts under Providers, create a key under API Keys, paste it.
   Press Enter to skip any key; you can add it later.
4. When it says "Setup finished", open a NEW terminal and type:  opencode

Adding a key later
------------------
Open PowerShell and run (replace the value):
  [Environment]::SetEnvironmentVariable('OPENROUTER_API_KEY', 'your-key', 'User')
  [Environment]::SetEnvironmentVariable('OMNIROUTE_API_KEY', 'your-key', 'User')
Then open a new terminal.

Useful
------
- Model ranking status:   python "%USERPROFILE%\.config\opencode\oc-status.py"
- OmniRoute dashboard:    http://localhost:20128
- Setup log:              shown at the end of setup (in your TEMP folder)

Removing it
-----------
Double-click uninstall.bat. It removes the background parts and, if you
confirm, the OpenCode config folder and the saved keys. The installed
programs stay; remove them from Settings > Apps if you want.
