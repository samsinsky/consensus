# Consensus

Route prose work between Claude, ChatGPT, and Gemini participants in one thread, on your existing subscriptions.

## Setup

1. Install and sign in to each CLI:
   - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`, then `claude` and `/login`
   - Codex CLI: `npm i -g @openai/codex`, then `codex login` (choose ChatGPT)
   - Antigravity CLI: `curl -fsSL https://antigravity.google/cli/install.sh | bash`, then `agy` to sign in, then quit
2. Build and link Consensus:
   ```bash
   npm install
   npm run build
   npm link
   ```
3. Run `consensus`. The app opens at http://localhost:4747.

## Daily use

- **New thread** for each piece of copy.
- The **To:** chip picks the participant, or adds a new one with its own provider, model and effort.
- **Forward ▸** attaches a reply, or just the highlighted part, to your next message. Models see it as "Feedback from another reviewer" and never learn who wrote it.
- **Panes** shows each participant's conversation side by side.
- **Settings** edits the system prompt (applies to new participants) and default models.

Data lives in `~/.consensus`. Threads are plain JSON in `~/.consensus/threads`.

## Development

```bash
npm run dev:server   # API on :4747
npm run dev:web      # UI on :5173 with hot reload
npm test             # unit tests, no quota used
npm run smoke        # live check against the real CLIs, uses a little quota
```

Run `npm run smoke` after upgrading any of the three CLIs.
