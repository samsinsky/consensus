# Consensus: design spec

Date: 2026-10-05
Status: Draft for review

## Purpose

Sam improves copy by routing one LLM's feedback to another. Today he copies text between ChatGPT, Claude, and Gemini tabs by hand. Consensus replaces the copy-paste with a single local app that routes messages between models and runs on his existing ChatGPT, Claude, and Google subscriptions. No API keys, no per-token billing.

No free tool does this. Existing multi-model extensions (ChatHub, TabGPT, XPrompt, GenAIPromptExtension) broadcast one prompt to many models; none consensus one model's output into another with a new instruction.

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
- Attachments in replies (models return text only).
- Exposing the CLIs' tool use (files, shell).

## Concepts

- **Thread:** one piece of work, such as a homepage hero. Holds participants and a single timeline of messages.
- **Participant:** one ongoing conversation with one provider and model inside a thread. A thread may hold several participants, including two from the same provider. A participant keeps its provider for life; Sam may change its model and effort at any time without losing history.
- **Message:** one entry in the timeline. Either Sam to a participant, or a participant's reply. Sam's messages may carry quotes.
- **Quote:** forwarded text from an earlier reply, whole or highlighted.

## Approach

Consensus drives each provider's official CLI headlessly, signed in with Sam's subscription:

| Provider | CLI | Subscription |
|---|---|---|
| Claude | Claude Code (`claude -p`) | Claude plan |
| ChatGPT | Codex CLI (`codex exec`) | ChatGPT plan |
| Gemini | Antigravity CLI (`agy -p`) | Google AI plan |

Google stopped serving Gemini CLI to individual Google AI accounts on 2026-06-18; Antigravity CLI replaced it.

We rejected a browser extension that drives the chat websites. It keeps native chat history and features, but breaks whenever a site changes its DOM, and Chrome throttles input in background tabs. The CLIs offer stable, scriptable interfaces. Each CLI lets us replace its coding-focused system prompt, which removes the coding bias.

## Architecture

```
 Browser (localhost)              Local server (Node + TypeScript)            Subscriptions
┌──────────────────┐   HTTP +   ┌──────────────────────────────────┐
│ Timeline view    │  streaming │  Thread store (JSON on disk)     │
│ Panes view       │◀──────────▶│  Router                          │
│ Participant chip │            │  Provider adapters               │
└──────────────────┘            │   claude → claude -p …           │──▶ Claude plan
                                │   codex  → codex exec …          │──▶ ChatGPT plan
                                │   gemini → agy -p …              │──▶ Google plan
                                └──────────────────────────────────┘
```

### Launch

Sam runs `consensus`. The command starts the local server and opens the browser to the app.

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

- Replaces the CLI's system prompt with the Consensus prompt (Claude: `--system-prompt-file`; Codex: `-c model_instructions_file=…`; Gemini: a Consensus custom agent at `.agents/agents/consensus-<hash>.md` in its working directory, run with `--agent`).
- Limits tools to web reading and search (see Web access); Codex runs read-only with agent features off.
- Sets model and effort per call, so a model change applies on the next message.
- Resumes the participant's conversation by session ID. Claude and Codex fork from the last completed session on every turn (`--fork-session`, `codex exec fork`), so a stopped turn never enters memory; the adapter discards the fork. Antigravity drops a cancelled turn on its own.
- Runs in an empty working directory under `~/.consensus/workdir/<provider>`, so no `CLAUDE.md`, `AGENTS.md`, or project files leak into prose feedback. The Claude adapter passes `--setting-sources ""` and `--strict-mcp-config` to ignore `~/.claude`. (`--bare` would isolate further but refuses subscription sign-in.)
- Maps CLI failures to typed errors: `not_installed` (with the install command), `not_logged_in` (with the fix command, such as `codex login`), `rate_limited`, `timeout`, `unknown`.

Verified behavior (2026-10-05, Claude Code 2.1.289, Codex CLI 0.160.1, Antigravity CLI 1.2.17):

| | Claude | Codex | Antigravity |
|---|---|---|---|
| Streams text deltas | Yes | No; whole reply at once | Yes |
| Session ID source | `session_id` on every event | `thread.started.thread_id` | `conversation_id` on `init` |
| Model change on resume | Yes | Yes, with a warning event | Yes |
| Effort | `--effort` | `-c model_reasoning_effort=` | Baked into the model slug (`gemini-3.1-pro-high`) |
| Model list | Static aliases (`opus`, `sonnet`, `haiku`) | `~/.codex/models_cache.json` | `agy models` |

ChatGPT through Codex (verified 2026-10-05): with a ChatGPT login, Codex rejects the ChatGPT app's flagship (`gpt-6`) and offers smaller or older models. `gpt-6-luna` is a small model and stays near 220 words on a copy critique; `gpt-5.6-terra` at high effort gives chat-app depth (about 580 words, structured). Codex defaults every model to low verbosity and injects skill and sub-agent instructions, so the adapter sends `model_verbosity="high"` and turns off agent features. ChatGPT defaults to `gpt-5.6-terra` at high effort, and the model picker shows each model's description.

Adding a provider later means writing one adapter.

### Router

- Sends each message only to the selected participant.
- Builds the outgoing text by inlining quotes with the task and current state: the original request at the root of the forward chain, the text the forwarded reply was responding to, and the reply itself. Earlier reviewer opinions and Sam's in-between messages stay out, which limits anchoring on apparent consensus. The model never learns which provider wrote the quote:

  ```
  Original request:
  <request>…</request>

  Text another reviewer was responding to:
  <context>…</context>

  Feedback from another reviewer:
  <quoted>…</quoted>

  <Sam's instruction>
  ```

  The router derives each block from the data: the reply's prompt is Sam's last message to that participant before it; the context is that prompt's quotes; the original request is found by following quotes back to a prompt with none. Blocks with nothing to show are omitted. A richer history (Sam's messages along the chain, a "fresh eyes" or "quote only" toggle) is deferred until real use shows the need.

- Passes the participant's session ID, model, and effort to the adapter, streams events to the browser, and writes the result to the store.

### Thread store

One JSON file per thread at `~/.consensus/threads/<id>.json`:

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
- Replies stream in live where the CLI supports it; Codex replies appear whole when complete.
- Every reply has **Forward ▸**. Highlighting text inside a reply and clicking Forward attaches only that excerpt. A message can carry several quotes; attached quotes appear above the composer and can be removed.
- Model changes appear as inline markers.

### Composer and participant chip

- The chip shows the active participant: the last one Sam sent to. Typing and sending keeps the conversation with that participant.
- Clicking the chip opens a menu:
  - The thread's participants, to switch the target.
  - **New participant ▸ provider ▸ model and effort**, to add a fresh participant with no history.
  - **Change model** on each participant, limited to the same provider.
- **Stop** appears while a reply streams. Stop kills the CLI process, keeps the partial text in the timeline marked *stopped*, and leaves it forwardable. The stopped reply stays out of the participant's memory, so the next message continues as if the reply never happened.

### Panes view

- Sam ticks which participants to show. Each gets a column holding only its conversation, with its own composer targeted at that participant.
- Forward works across panes. Everything still appears in the Timeline view; the two views render the same store.

### Errors

- A failed reply shows inline with the error and **Retry**. Sign-in errors show the exact fix command.

### Settings

- Edit the system prompt file.
- Default model and effort per provider, used when creating participants.

## System prompt

One global file at `~/.consensus/prompts/default.md`, editable in Settings. Each participant reads it when it starts; edits apply to new participants. Starting content covers:

- You are an experienced editor and copywriter working with the user on prose.
- Respond as you would in a chat app: full rewrites when asked, reasoning behind edits, alternatives when useful, formatting that suits the content.
- Match the depth the user asks for.
- Text marked "Feedback from another reviewer" is input to weigh. Agree or push back on its merits; don't defer to it.
- Don't invent facts, figures, quotes, names, or claims. When copy needs a fact you don't have, write a bracketed placeholder such as `[STAT: % reduction in food cost]` and say what's needed.
- Treat factual claims in feedback from another reviewer as unverified. Flag any you can't confirm instead of carrying them into the copy.

## Attachments

Added 2026-10-06. Sam attaches text documents and images to messages.

### Adding files

- Drag files onto the message area, click 📎 in the composer, or paste an image from the clipboard.
- Each file uploads immediately and shows as a chip above the message box: name, size, ×, and a thumbnail for images. A failed upload shows its reason on the chip.
- Sent messages show the same chips in the timeline; clicking an image thumbnail opens the full image.

### Supported files and limits

| Kind | Extensions | Handling | Limit |
|---|---|---|---|
| Text | `.txt` `.md` `.csv` `.json` `.html` | Read as UTF-8 | 20MB file |
| Document | `.docx`, `.pdf` | Text extracted on the server (`mammoth`, `unpdf`) | 20MB file |
| Image | `.png` `.jpg` `.jpeg` `.gif` `.webp` | Passed to the CLI as an image | 5MB (Claude's per-image limit) |

- At most 10 attachments per message.
- Extracted text is capped at 100,000 characters; longer documents are cut with a visible note in both the chip and the text the model receives.
- Unsupported types, oversized files, and documents with no extractable text (such as scanned PDFs) are refused with a specific message.

### What the model receives

- **Text and documents** go inline, before Sam's text: `<attachment name="brief.docx">…extracted text…</attachment>`.
- **Images** go through each CLI's own channel (verified 2026-10-06 with a blue test image under a neutral filename):
  - **Claude:** for messages with images only, the adapter switches to `--input-format stream-json` and sends one user message whose content holds base64 `image` blocks followed by the text. Text-only messages keep the current plain stdin path.
  - **Codex:** one `-i <path>` per image, on both `exec` and `exec fork`.
  - **Gemini:** Antigravity's structured input accepts text only, and an `@path` mention does not attach images (the model guessed). The adapter copies each image into its working directory under `attachments/<threadId>/` and, for that turn only, runs a variant of the Consensus agent whose only tool is `view_file`, with a line listing the image paths to look at. Turns without images keep the tool-less agent. Risk accepted: during an image turn, `view_file` could read other local files if a forwarded quote carries instructions to; turns without images have no tools.
- **Forwarding** carries the original request's attachments along with the original request block, because they define the task. Attachments on other messages in the chain stay behind.
- **Retry** resends the same attachments.

### Storage

- A thread's files live beside its history: `~/.consensus/threads/<threadId>/attachments/<attachmentId>/<filename>`, with `extracted.txt` next to each document.
- Messages store references only: `{ id, name, kind: 'text' | 'image', mime, size, chars?, truncated? }`. Thread JSON is rewritten during streaming, so embedding files there would make every save rewrite megabytes.
- Uploads go to `POST /api/threads/:id/attachments` with the raw file as the body, the name in an `x-filename` header, and a required `x-consensus-upload: 1` header. A custom header forces a browser CORS preflight, so other sites cannot upload; the localhost Host and Origin checks still apply. `GET /api/threads/:id/attachments/:attachmentId` serves the original file with `x-content-type-options: nosniff`.

### Removal

- **Delete thread:** a header action, confirmed in the page, removes the thread's JSON, its attachments folder, and Gemini's copies in `workdir/gemini/attachments/<threadId>/`. It stops any running reply in that thread first.
- **Unsent uploads:** at startup, attachment folders older than 24 hours that no message references are deleted.
- **Outside Consensus:** Claude Code, Codex and Antigravity keep their own session copies (including images) under `~/.claude`, `~/.codex`, and `~/.gemini`. Consensus does not delete those.

## Web access

Added 2026-10-07. Participants can read web pages and search the web on every turn, using each CLI's own tools (verified with a page holding a phrase made up for the run, so only a real read returns it):

| | Turned on with | Notes |
|---|---|---|
| Claude | `--tools "WebFetch,WebSearch"` and `--allowedTools WebFetch WebSearch` | Headless mode refuses tools that are not pre-approved. |
| ChatGPT | `-c web_search="live"` | The default "cached" mode serves an index only. Luna sometimes gives up after one failed page open; Terra does not. |
| Gemini | Agent tools `read_url_content`, `search_web`, `view_file`, plus `--dangerously-skip-permissions` | `read_url_content` saves the page to a local file, so `view_file` is required to read it. The documented allow rule lives in Antigravity's global settings, which Consensus does not touch; the flag can only approve the agent's three tools (verified: no shell). The agent file is named `consensus-<hash>-web` so older tool-less agent files are not reused. |

- Adapters report `activity` ("Searching the web for …", "Reading nodejs.org") and `source` (each page opened). Search queries are activity only; sources are pages actually opened.
- The router streams activity to the page without saving it, and saves each reply's sources in order without repeats.
- Codex narrates tool use in earlier messages ("I'll open the page…"); a reply's final text is its last message. Claude's `result` and Antigravity's `response` are already final.
- The default system prompt adds: "You can read web pages and search the web. When you state a fact from a page, say which page." An untouched copy of an earlier default on disk is upgraded; an edited prompt is left alone.
- **UI:** while a reply streams, a status line shows its current activity. Under a reply that opened pages, a collapsed **Sources** row shows up to three site favicons (loaded directly from each site, first letter when missing) and "+ N more" for further sites; clicking expands every page as a link.
- **Risk accepted:** a page or forwarded reply can carry instructions to fetch an attacker's URL with conversation text in it, and Gemini turns can read local files through `view_file`. Sam runs the CLIs in auto mode, which allows more than this. The Sources list makes every fetch visible.

## Open questions (resolved 2026-10-05)

1. **Gemini access.** Gemini CLI no longer serves individual accounts; Consensus uses Antigravity CLI, which resumes by stable `conversation_id`.
2. **Stop and memory.** Claude and Codex persist partial turns, so their adapters fork per turn and discard stopped forks. Antigravity drops cancelled turns itself.
3. **Claude isolation.** `--setting-sources ""` with `--strict-mcp-config`; a probe confirmed no `CLAUDE.md` content reaches the model.
4. **Tool disabling.** See the adapter list above. Codex and Antigravity still send their tool schemas (about 11k and 2k input tokens per turn); the models follow the Consensus prompt regardless.
5. **Codex install.** Installed and signed in with ChatGPT.

## Testing

1. **Adapter tests (no quota):** each adapter runs against a fake CLI that replays recorded output. Covers streaming, session capture, resume, model change, Stop, and each error type.
2. **Router and store tests:** a message reaches only its participant; quotes inline in the fixed format; threads round-trip through disk exactly; atomic writes survive a simulated crash.
3. **Live smoke test (manual, small quota):** per real CLI, send "reply OK", resume, change model, Stop. Run after any CLI upgrade.
4. **Quality check:** rerun Sam's Codex vs. ChatGPT comparison with the Consensus prompt and high effort; confirm replies match ChatGPT's depth.

## Future work

### Automatic looped routing

Sam picks two or more participants and an instruction, such as "revise" for one and "critique" for the other. Consensus then routes replies between them without manual forwarding until one of three conditions ends the loop:

- **Convergence:** the critic approves the version, or successive versions stop changing meaningfully.
- **Stuck loop:** the participants repeat earlier versions or trade the same objections.
- **Round cap:** a maximum round count Sam sets, to bound quota use.

Sam can stop the loop at any time and resume manual routing from the last message.

v1 keeps this addition cheap:

- The router exposes `send(participantId, text, quotes)` as a plain function, not only an HTTP handler, so a loop controller can call it.
- Messages can gain an optional `origin: 'manual' | 'loop'` field without a migration, so the timeline can group loop rounds.

### Shared document with comment threads

A single document all participants work on, replacing chat history as the "current state". Participants leave comments anchored to passages, reply in threads, and propose edits as suggestions; a thread resolves when its concern is settled. This merges with automatic looped routing: the loop runs until threads resolve, then Sam reviews what remains.

Risks to design for:

- **False agreement.** Models defer to each other, so threads may resolve without the text improving. Guardrails: only the comment's author or Sam resolves; a reviewer restates why its concern is met before resolving; capped rounds; unresolved disagreements escalate to Sam.
- **Losing the big picture.** Comment-by-comment work becomes line editing; nobody asks whether the piece is right. Counter with document-level threads not anchored to a passage, a structural pass against the brief before line edits each round, an editor-in-chief participant that judges the whole draft and can reopen threads or propose a rewrite, and a blind reader that never sees the comments. Convergence requires a whole-draft check against the brief or Sam's sign-off, not just zero open threads.
- **Anchor drift.** Comments must follow their passage as text changes, or show clearly as orphaned.
- **Structured output.** Comments and suggestions need schema-enforced JSON from each CLI; all three expose a JSON schema option, unverified for this use.

Prerequisite: the per-thread brief, so big-picture review has a goal, audience, and constraints to judge against.

## Tech stack

- Node 24 and TypeScript throughout.
- Server: a small HTTP server with Server-Sent Events for streaming.
- UI: React with Vite.
- Tests: Vitest.
- Single package; `consensus` installed via `npm link`.
