# Qlix Assessment

Observes your selected project workspace as evidence for a Qlix assessment session you've explicitly connected to. Private extension — not published to the VS Code Marketplace; distributed directly as a `.vsix`.

## What it does

Install it, open the project folder, and paste the one-time code when Qlix asks (it prompts on its own — you do not need to hunt for a command). It then watches **only that folder** — file saves, Git commits, terminal commands, and task results — and sends small summaries to Qlix. It never reads files outside that folder, never captures `.env`/keys/credentials, and never sends raw keystrokes.

## Commands

- **Qlix: Connect Assessment** — enter your one-time connect code.
- **Qlix: Pause / Resume Observation**
- **Qlix: Submit Project**
- **Qlix: Show Assessment Status** — also how you answer a pending defense-interview question from inside the editor.
- **Qlix: Disconnect Assessment**

## Development

```bash
npm install
npm run build      # bundle to dist/extension.js
npm run typecheck
npm run package     # produces a .vsix — install via "Extensions: Install from VSIX..."
```
