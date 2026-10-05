# Relay: design spec

Date: 2026-10-05
Status: Draft for review

## Purpose

Sam improves copy by routing one LLM's feedback to another. Today he copies text between ChatGPT, Claude, and Gemini tabs by hand. Relay replaces the copy-paste with a single local app that routes messages between models and runs on his existing ChatGPT, Claude, and Google subscriptions. No API keys, no per-token billing.

No free tool does this. Existing multi-model extensions (ChatHub, TabGPT, XPrompt, GenAIPromptExtension) broadcast one prompt to many models; none relay one model's output into another with a new instruction.

### Success criteria

- Sam drafts with one model, iterates with it, then forwards any reply (or part of one) plus a new instruction to another model, without leaving the page.
- Replies match the quality and depth of the consumer chat apps for prose work.
- Each model sees only its own conversation plus what Sam forwards.
- Threads persist locally and reload exactly.

### Non-goals (v1)

- Shared draft document (planned for a later version; the data model leaves room for it).
- Automatic looped routing (planned; see Future work).
- Per-thread briefs and per-participant system prompts.
- Sending one message to several participants at once.
- Mobile access, share links, voice, image generation.
- Exposing the CLIs' tool use (files, shell).

## Concepts

- **Thread:** one piece of work, such as a homepage hero. Holds participants and a single timeline of messages.
- **Participant:** one ongoing conversation with one provider and model inside a thread. A thread may hold several participants, including two from the same provider. A participant keeps its provider for life; Sam may change its model and effort at any time without losing history.
- **Message:** one entry in the timeline. Either Sam to a participant, or a participant's reply. Sam's messages may carry quotes.
- **Quote:** forwarded text from an earlier reply, whole or highlighted.

## Approach

Relay drives each provider's official CLI headlessly, signed in with Sam's subscription:

| Provider | CLI | Subscription |
|---|---|---|
| Claude | Claude Code (`claude -p`) | Claude plan |
| ChatGPT | Codex CLI (`codex exec`) | ChatGPT plan |
| Gemini | Gemini CLI (`gemini`) | Google plan |

We rejected a browser extension that drives the chat websites. It keeps native chat history and features, but breaks whenever a site changes its DOM, and Chrome throttles input in background tabs. The CLIs offer stable, scriptable interfaces. Each CLI lets us replace its coding-focused system prompt entirely, which removes the coding bias.

## Architecture

```
 Browser (localhost)              Local server (Node + TypeScript)            Subscriptions
┌──────────────────┐   HTTP +   ┌──────────────────────────────────┐
│ Timeline view    │  streaming │  Thread store (JSON on disk)     │
│ Panes view       │◀──────────▶│  Router                          │
│ Participant chip │            │  Provider adapters               │
└──────────────────┘            │   claude → claude -p …           │──▶ Claude plan
                                │   codex  → codex exec …          │──▶ ChatGPT plan
                                │   gemini → gemini …              │──▶ Google plan
                                └──────────────────────────────────┘
```

### Launch

Sam runs `relay`. The command starts the local server and opens the browser to the app.

### Provider adapters

One module per CLI, all behind one interface:

```ts
interface ProviderAdapter {
  id: 'claude' | 'codex' | 'gemini';
  listModels(): ModelOption[];          // models and effort levels offered in the UI
  send(req: {
    sessionId?: string;                 // absent on a participant's first message
    message: string;                    // final text, quotes already inlined
    model: string;
    effort?: string;
    systemPromptFile: string;
    signal: AbortSignal;                // Stop
  }): AsyncIterable<AdapterEvent>;      // text deltas, session id, done, error
}
```

Every adapter:

- Replaces the CLI's system prompt with the Relay prompt file (Claude: `--system-prompt-file`; Codex: `-c model_instructions_file=…`; Gemini: `GEMINI_SYSTEM_MD=…`).
- Disables file and shell tools (Claude: `--tools ""`; Codex and Gemini: equivalent settings, confirmed during the build).
- Sets model and effort per call, so a model change applies on the next message.
- Resumes the participant's conversation by session ID.
- Runs in an empty working directory under `~/.relay/workdir`, so no `CLAUDE.md`, `AGENTS.md`, or project files leak into prose feedback. The Claude adapter also ignores user settings in `~/.claude` (flag confirmed during the build).
- Maps CLI failures to typed errors: `not_logged_in` (with the fix command, such as `codex login`), `rate_limited`, `timeout`, `unknown`.

Adding a provider later means writing one adapter.

### Router

- Sends each message only to the selected participant.
- Builds the outgoing text by inlining quotes in a fixed format. The model never learns which provider wrote the quote:

  ```
  Feedback from another reviewer:
  <quoted>…</quoted>

  <Sam's instruction>
  ```

- Passes the participant's session ID, model, and effort to the adapter, streams events to the browser, and writes the result to the store.

### Thread store

One JSON file per thread at `~/.relay/threads/<id>.json`:

```ts
type Thread = {
  id: string; title: string; createdAt: string; updatedAt: string;
  participants: Participant[];
  messages: Message[];
};
type Participant = {
  id: string; provider: 'claude' | 'codex' | 'gemini';
  model: string; effort?: string;
  sessionId?: string;                   // set after the first reply
  label: string;                        // e.g. "Claude · Opus high", numbered on collision
};
type Message =
  | { id: string; kind: 'user'; to: string; text: string; quotes: Quote[]; sentAt: string }
  | { id: string; kind: 'reply'; from: string; text: string; model: string; effort?: string;
      status: 'streaming' | 'done' | 'stopped' | 'error'; error?: AdapterError; sentAt: string }
  | { id: string; kind: 'model_change'; participant: string; from: string; to: string; sentAt: string };
type Quote = { messageId: string; text: string };   // text may be a highlighted excerpt
```

Writes go to a temp file and rename into place, so a crash never corrupts a thread.

## Interface

### Layout

- **Threads sidebar:** list of threads, newest first, plus **New thread**.
- **Main area:** the active thread in Timeline view (default) or Panes view.

### Timeline view

- One column holding every message in the thread, in order. Each message shows a provider-colored mark and a label such as "You → ChatGPT · Luna high" or "ChatGPT · Luna high".
- Replies stream in live.
- Every reply has **Forward ▸**. Highlighting text inside a reply and clicking Forward attaches only that excerpt. A message can carry several quotes; attached quotes appear above the composer and can be removed.
- Model changes appear as inline markers.

### Composer and participant chip

- The chip shows the active participant: the last one Sam sent to. Typing and sending keeps the conversation with that participant.
- Clicking the chip opens a menu:
  - The thread's participants, to switch the target.
  - **New participant ▸ provider ▸ model and effort**, to add a fresh participant with no history.
  - **Change model** on each participant, limited to the same provider.
- **Stop** appears while a reply streams. Stop kills the CLI process, keeps the partial text in the timeline marked *stopped*, and leaves it forwardable. The goal: the stopped reply stays out of the participant's memory, so the next message continues as if the reply never happened. The build confirms each CLI's behavior and documents any exception.

### Panes view

- Sam ticks which participants to show. Each gets a column holding only its conversation, with its own composer targeted at that participant.
- Forward works across panes. Everything still appears in the Timeline view; the two views render the same store.

### Errors

- A failed reply shows inline with the error and **Retry**. Sign-in errors show the exact fix command.

### Settings

- Edit the system prompt file.
- Default model and effort per provider, used when creating participants.

## System prompt

One global file at `~/.relay/prompts/default.md`, editable in Settings. Each participant reads it when it starts; edits apply to new participants. Starting content covers:

- You are an experienced editor and copywriter working with the user on prose.
- Respond as you would in a chat app: full rewrites when asked, reasoning behind edits, alternatives when useful, formatting that suits the content.
- Match the depth the user asks for.
- Text marked "Feedback from another reviewer" is input to weigh. Agree or push back on its merits; don't defer to it.
- Don't invent facts, figures, quotes, names, or claims. When copy needs a fact you don't have, write a bracketed placeholder such as `[STAT: % reduction in food cost]` and say what's needed.
- Treat factual claims in feedback from another reviewer as unverified. Flag any you can't confirm instead of carrying them into the copy.

## Open questions resolved during the build

The first tasks answer these before the adapters depend on them:

1. **Gemini resume.** Gemini CLI 0.24 resumes by list index, not a stable ID. If indexing proves unreliable under concurrent threads, the Gemini adapter replays the full conversation on each call instead.
2. **Stop and memory.** Whether each CLI persists a partial reply into its session after a kill. Where it does, the adapter compensates (for example, by forking from the prior session) or the UI notes the exception.
3. **Claude isolation.** Which flag keeps Claude Code from loading `~/.claude` settings and instructions.
4. **Tool disabling** for Codex and Gemini.
5. **Codex install.** Codex CLI is not installed on this machine; setup installs it and runs `codex login`.

## Testing

1. **Adapter tests (no quota):** each adapter runs against a fake CLI that replays recorded output. Covers streaming, session capture, resume, model change, Stop, and each error type.
2. **Router and store tests:** a message reaches only its participant; quotes inline in the fixed format; threads round-trip through disk exactly; atomic writes survive a simulated crash.
3. **Live smoke test (manual, small quota):** per real CLI, send "reply OK", resume, change model, Stop. Run after any CLI upgrade.
4. **Quality check:** rerun Sam's Codex vs. ChatGPT comparison with the Relay prompt and high effort; confirm replies match ChatGPT's depth.

## Future work

### Automatic looped routing

Sam picks two or more participants and an instruction, such as "revise" for one and "critique" for the other. Relay then routes replies between them without manual forwarding until one of three conditions ends the loop:

- **Convergence:** the critic approves the version, or successive versions stop changing meaningfully.
- **Stuck loop:** the participants repeat earlier versions or trade the same objections.
- **Round cap:** a maximum round count Sam sets, to bound quota use.

Sam can stop the loop at any time and resume manual routing from the last message.

v1 keeps this addition cheap:

- The router exposes `send(participantId, text, quotes)` as a plain function, not only an HTTP handler, so a loop controller can call it.
- Messages can gain an optional `origin: 'manual' | 'loop'` field without a migration, so the timeline can group loop rounds.

### Shared draft

A single document all participants can edit, with highlight-to-ask and per-version attribution.

## Tech stack

- Node 24 and TypeScript throughout.
- Server: a small HTTP server with Server-Sent Events for streaming.
- UI: React with Vite.
- Tests: Vitest.
- Single package; `relay` installed via `npm link`.
