# Consensus doc mode: design

Date: 2026-10-13. Status: implemented 2026-10-13.
Builds on `2026-10-05-consensus-design.md` (the "Shared document with comment threads" future-work item).

## Purpose

Forwarding replies between participants loops: each model restates its taste, settled points come back, and every round produces a full rewrite. Doc mode replaces the back-and-forth with one document that every participant reviews. Each participant proposes specific changes with a reason, replies to the other proposals, and leaves one note on the whole draft. Sam edits the document live, settles proposals, and sends the next round when he wants one.

### Success criteria

- Sam can paste a draft, add a brief, pick reviewers, and get proposals in the margin within one round.
- Every proposed change shows who proposed it and why, inline in the text and in a margin card.
- Sam can accept, reject, edit before accepting, or reply to any proposal, and type in the document at any time, including while a round runs.
- Competing proposals on the same text show as one card with options, not stacked edits.
- Participants react to each other's proposals in the next round, and taste disagreements are tagged "Your call" for Sam.
- One click copies the document as formatted text.

### Non-goals (v1)

- Real-time collaboration between people. Only Sam edits live; models act in rounds.
- Rounds that run automatically. Sam starts each round. Automatic looping stays in future work.
- A reply pass inside a round (models replying to same-round proposals). Cross-review happens in the next round.
- A chat panel inside a doc thread.
- Tables, images, comments by people other than Sam, sharing, or permissions.
- Formatting beyond paragraphs, headings, bold, italic, lists, and links.

## Concepts

- **Doc thread:** a thread whose content is a document instead of a timeline. A thread is either a chat or a doc.
- **Brief:** Sam's short description of the task, audience, and constraints, stored with the doc and sent every round.
- **Round:** one send to every included participant, all reviewing the same saved version of the document at once.
- **Proposal:** one change from one participant: the quoted text, its replacement, and a reason. Shown inline and as one margin card.
- **Group:** open proposals whose quoted text overlaps, shown as one card with options.
- **Reply:** a message on a proposal's thread, from Sam or a participant. A participant's reply carries a stance: agree, disagree, or your call.
- **Overall note:** each participant's one comment per round on the whole draft.
- **Included:** whether a participant takes part in the next round. Toggled by clicking its name.

## Interface

### Layout

```
┌──────────────────────────────────────────────┬───────────────────────────┐
│ Brief: LinkedIn bio, technical PM audience…   │                    [⟲][⧉] │
│──────────────────────────────────────────────│ ┌ Overall notes ────────┐ │
│ I make complicated systems feel simple at    │ │ Claude Opus High …    │ │
│ every layer: schema, algorithm, and          │ │ ChatGPT Terra High …  │ │
│ interface. ...                               │ └───────────────────────┘ │
│                                              │                           │
│ ... Through my Master's in Data Science at   │ ┌───────────────────────┐ │
│ UC Berkeley, I've ~~gone deep on~~ gained    │ │ ChatGPT Terra High    │ │
│ hands-on experience with LLM fine-tuning...  │ │ Your call   ✓1  ✗1    │ │
│                                              │ │ "Gone deep on" is     │ │
│                                              │ │ vague; this is more   │ │
│                                              │ │ concrete.             │ │
│                                              │ │ Claude: disagree, …   │ │
│                                              │ │ [Accept] [Reject]     │ │
│                                              │ │ Reply…                │ │
│                                              │ └───────────────────────┘ │
├──────────────────────────────────────────────┴───────────────────────────┤
│ Ask for review: ✓ Claude Opus High • ✓ ChatGPT Terra High + 1 more ▾ [Send] │
└──────────────────────────────────────────────────────────────────────────┘
```

- The thread sidebar, its collapse, and its resize work as in chat threads. Doc threads show a small document icon beside their name.
- The document fills the center. The margin sits on the right. The review bar sits at the bottom.

### Starting a doc

- **New thread** offers Chat or Doc. Doc opens an empty document with a brief field above it. Sam pastes or types the draft and writes the brief. The brief field accepts attachments through the existing paperclip, drop, and paste, with the existing limits.
- **Open as doc** on any chat reply creates a new doc thread: the reply's text becomes the document, the chat thread's first message becomes the brief, and its participants are copied with fresh sessions (no chat memory), so a doc never shares a CLI conversation with a chat thread. Sam deletes any commentary the reply carried.
- The thread title comes from the brief's first line, renameable as today.

### The document

- Sam edits directly at any time, including during a round. Edits change the document; they are not proposals.
- Autosave runs about a second after typing stops. Send saves first.
- Formatting: paragraphs, headings, bold, italic, bulleted and numbered lists, and links, stored as Markdown. No toolbar: the usual shortcuts (Cmd+B, Cmd+I, Cmd+K) and Markdown typed at the start of a line ("## ", "- ", "1. ") apply formatting.
- **Copy:** an icon in the document's top corner copies the whole document to the clipboard as formatted text (HTML) with a plain-text fallback, so it pastes cleanly into Google Docs, LinkedIn, or Gmail. A brief "Copied" confirmation shows.
- **History:** an icon beside Copy lists one snapshot per round ("Round 3 · 2:14 PM"), taken as the round was sent. Picking one shows it read-only with a Restore button. Restore replaces the document text; proposals re-anchor against it as after any edit.

### Proposals inline

- An open proposal draws over the text: the quoted words struck through and the replacement after them, in the author's color. Proposals are drawn on top of the document and never stored in it.
- Clicking proposal text selects its card and the reverse; the selected card lines up beside its text.
- For a group, the text shows only the option selected on its card, so the document never shows two edits on the same words.

### Margin cards

- **One card per proposal.** Cards sit level with their text and push each other down when text is close together, as in Google Docs.
- **Card contents:** author label (`participantName` with model and effort, as in the chip), the reason, agree and disagree counts from participant replies (the author counts as agree), the "Your call" tag when it applies, the reply thread, Accept and Reject buttons, and a reply box.
- **Editing before accepting:** Sam can click into the replacement text on the card, change it, and accept his version.
- **Groups:** overlapping open proposals share one card titled "N versions". Each option shows its author, replacement, reason, and its own thread. Selecting an option switches the inline view to it. Accepting one marks the others "not chosen". "Reject all" rejects every option. Selecting an option is a view choice only; it is not sent to participants.
- **Merged proposals:** identical replacements of the same text from the same round become one proposal with several authors ("Claude Opus High and ChatGPT Terra High"). A participant that later proposes an exact copy of an open proposal is recorded as an agree reply on it instead.
- **Your call:** the tag shows when any participant replied "your call" on the proposal or on any option of its group.
- **Out of date:** when the quoted text no longer exists (Sam edited it, or another proposal's acceptance removed it), the card turns grey, says "Text changed", and offers only Dismiss.
- **Resolved:** accepted, rejected, not chosen, and dismissed proposals collapse into one thin "N resolved" line at the bottom of the margin that expands to show them with their threads.
- **Overall notes:** pinned at the top of the margin, one per participant for the latest round, each expandable to the participant's full answer for that round. Earlier rounds' notes are reachable from the same card. Proposals that failed the quote check are listed on their author's note card with the reason ("matched 3 places", "not found").

### Review bar

```
Ask for review:  ✓ Claude Opus High • ✓ ChatGPT Terra High + 1 more  ▾          [Send]

  ┌──────────────────────────────────────┐
  │ ✓ Claude Opus High              ×   │   green: included
  │ ✓ ChatGPT Terra High            ×   │   green: included
  │   Claude Opus Med               ×   │   white: skipped
  │ + Add participant                    │
  └──────────────────────────────────────┘
```

- The summary line lists included participants only, up to three, then "+ N more".
- The dropdown lists every participant. Clicking a name toggles included (green, with a check) or skipped (white, no check). × removes the participant from the thread. "Add participant" opens the existing Provider / Model / Effort picker. Several participants from the same provider are numbered as today.
- Inclusion persists between rounds and across reloads.
- Send is disabled when no participant is included or a round is running.
- During a round, each included participant shows a spinner in the summary line and dropdown with its current activity ("Reading a page…"), and Send becomes Stop. Stop ends the round for every participant still running; proposals from participants that finished stay.
- Proposals appear as each participant finishes.

### Errors

Per participant, on its overall note card: the adapter error with its fix (as in chat), or the parse error with the raw answer viewable. A failed participant never blocks the others.

## Rounds

### Sending

Sam clicks Send. The server saves a snapshot of the current document, then sends the round message to every included participant in parallel, each in its own session. Open proposals, including ones Sam has not touched, go as undecided. Sam never has to resolve anything before sending.

### What each participant receives

The round message, built fresh each round:

~~~
Brief:
<brief>
…Sam's brief…
</brief>
<attachment …>…</attachment>            (brief attachments, text extracted; images as image inputs)

Document (round 3):
<document>
…full Markdown of the saved document…
</document>

Open proposals:
<proposal id="P4" by="you|another reviewer">
Replace: "…quote…"
With: "…replacement…"
Reason: …
Replies:
- Another reviewer (disagree): …
- Me: …
</proposal>
…

Rejected since your last review:
- P2: "…quote…" → "…replacement…" (my reply: …)

What to do:
1. Propose changes only to fix real problems: errors, unclear writing, or anything that misses the brief. If a change comes down to taste, leave it.
2. Reply to each open proposal you didn't write: agree, disagree with a reason, or "your call" when it comes down to taste.
3. Leave one short note on the whole draft: structure, direction, and anything line edits would miss.
4. Don't rewrite the whole document.

End your answer with one JSON block in exactly this shape:
```json
{
  "proposals": [{ "quote": "exact words from the document", "replacement": "new words", "reason": "one or two sentences" }],
  "replies": [{ "proposal": "P4", "stance": "agree" | "disagree" | "your_call", "text": "one or two sentences" }],
  "note": "your note on the whole draft"
}
```
For "quote", copy the exact words from the document without formatting marks, long enough to appear only once. To delete text, use an empty replacement. To add text, quote the words it follows and include them in the replacement.
~~~

- A proposal is labeled `by="you"` when the receiving participant wrote it and `by="another reviewer"` otherwise. Participants never learn which provider wrote what.
- Sam's replies are labeled "Me".
- Rejected proposals list those resolved since the participant's previous round, with Sam's latest reply if any, so the participant doesn't propose them again.
- Accepted changes need no section: they are in the document.
- The round instructions take precedence over Sam's system prompt line "Provide the full rewrites in each response" through rule 4. Doc rounds keep the same system prompt snapshot as the participant's chat use.

### Reading the answer

- The server takes the last fenced `json` block in the answer, falling back to the last top-level `{…}` that parses.
- It validates the shape: strings where strings belong, known proposal ids in replies, known stances. Unknown fields are ignored.
- If no valid block is found, the server sends one follow-up turn in the same session: "Your answer was missing the JSON block (or: the JSON block failed: <reason>). Reply with only the JSON block." If that also fails, the participant's note card shows the error and the raw answer.
- The full prose answer is stored with the participant's overall note for the round.

### Anchoring

- **Plain text.** The document's plain text is its blocks' text without formatting marks, joined with blank lines. Quotes match against it after normalizing whitespace runs to one space and curly quotes and apostrophes to straight ones.
- **Validation on arrival.** A proposal's quote must match the round's snapshot exactly once. No match or several matches: the proposal is dropped and listed on the author's note card with the reason.
- **Context.** On a valid match the server stores up to 32 characters of plain text on each side (prefix and suffix).
- **Re-anchoring.** Against the live document, the client finds every occurrence of the quote. One occurrence: anchor there. Several: pick the one whose surrounding text best matches the stored prefix and suffix. None: the proposal is out of date.
- **Mapping.** The client maps plain-text offsets to editor positions by walking the document's text nodes, so formatting never breaks a match.
- Out of date is derived on display, not stored. Dismiss stores `dismissed`.

### Accepting

The client replaces the anchored text with the replacement, parsing inline Markdown in the replacement (bold, italic, links) into formatting, marks the proposal accepted, and saves. Remaining proposals re-anchor; any whose quote is gone become out of date, and others in its group become "not chosen".

## Architecture

### Editor

TipTap (open source, on ProseMirror) with StarterKit, Link, and Markdown in and out. Proposals render as ProseMirror decorations. Plain-text extraction, anchoring, and offset mapping live in a shared module used by both the server (validation) and the client (re-anchoring).

### Data

```ts
type Thread = {
  …existing fields…
  kind?: 'chat' | 'doc';            // absent means chat
  doc?: DocState;
};

type DocState = {
  brief: string;
  briefAttachments?: Attachment[];
  markdown: string;
  savedAt: string;
  included: string[];               // participant ids in the next round
  rounds: Round[];
  proposals: Proposal[];
};

type Round = {
  n: number;                        // 1-based
  sentAt: string;
  snapshot: string;                 // Markdown as sent
  participants: string[];
  notes: Record<string, RoundNote>; // by participant id
};

type RoundNote = {
  status: 'running' | 'done' | 'stopped' | 'error';
  note?: string;
  answer?: string;                  // full prose answer
  rejected?: { quote: string; reason: string }[];
  error?: AdapterError | { code: 'parse'; message: string };
};

type Proposal = {
  id: string;                       // "P1", "P2", … per document
  round: number;
  authors: string[];                // participant ids; several when merged
  quote: string;
  prefix: string;
  suffix: string;
  replacement: string;
  reason: string;
  status: 'open' | 'accepted' | 'rejected' | 'not_chosen' | 'dismissed';
  replies: ProposalReply[];
};

type ProposalReply = {
  from: 'user' | string;            // participant id
  stance?: 'agree' | 'disagree' | 'your_call';
  text: string;
  round?: number;
  at: string;
};
```

Doc threads store in the same `threads/<id>.json` file; brief attachments in the existing attachments folder. Existing chat threads need no migration.

### HTTP

All behind the existing Host, Origin, and content-type checks.

- `POST /api/threads` with `{ kind: 'doc' }` creates a doc thread.
- `POST /api/threads/:id/open-as-doc` with `{ replyId }` creates a doc thread from a chat reply.
- `PUT /api/threads/:id/doc` with `{ markdown, brief?, briefAttachmentIds? }` autosaves.
- `PATCH /api/threads/:id/participants/:pid` accepts `{ included }` alongside model changes.
- `POST /api/threads/:id/rounds` starts a round for the included participants; `POST /api/threads/:id/rounds/stop` stops it.
- `PATCH /api/threads/:id/proposals/:pid` with `{ status }` or `{ replacement }`.
- `POST /api/threads/:id/proposals/:pid/replies` with `{ text }`.
- `POST /api/threads/:id/restore` with `{ round }`.
- Server-Sent Events gain `doc` (state changes), and reuse `activity` per participant.

### Server

- A `DocRounds` module beside the router builds round messages, runs participants through the existing adapters and session handling (fork per turn for Claude and Codex), parses and validates answers, merges duplicates, and commits results. It reuses the router's busy guard: one round at a time per thread, and a doc thread never accepts chat sends.
- Stop and deletion behave as in chat: a stopped participant's turn never enters its memory.

## Error handling

- Adapter errors: as in chat, shown on the participant's note card, with Retry for that participant only.
- Parse errors: one automatic follow-up, then an error with the raw answer.
- Quote failures: listed per participant; never block other proposals.
- Autosave failure: a small "Not saved" marker beside Copy, retried on the next edit; Send refuses until the save succeeds.
- Deleting a doc thread mid-round stops the round and discards results, as chat does.

## Testing

- **Unit:** plain-text extraction from Markdown; quote matching (exact, normalized whitespace and quotes, repeated phrases resolved by context, missing quote); offset mapping across formatting; JSON extraction (fenced, bare, missing, malformed) and validation; duplicate merging; grouping of overlapping proposals; "Your call" and out-of-date derivation; round message composition (labels, rejected-since list, no provider names).
- **Router-level with fake CLIs:** parallel round with mixed success, parse failure then repair, Stop mid-round, inclusion toggling, restore.
- **Web (jsdom):** margin card ordering and grouping, accept and reject flows, review bar toggling and summary text.
- **Live:** one round with all three CLIs on a real draft, a second round to check cross-replies, and copy into Google Docs.

## Decisions

- **Parallel rounds, no reply pass.** Independent first opinions and speed; cross-review happens next round. The reply pass can be added later.
- **Proposals anchored by quote, not stored in the text.** Avoids tracked-change marks in the editor; edits make proposals out of date instead of corrupting them.
- **JSON block in the answer, not CLI schema options.** One parser across three CLIs, with prose kept for Sam. CLI schema options stay a later upgrade.
- **Fresh sessions for Open as doc.** A doc never shares a CLI conversation with a chat thread.
- **Built in Consensus, not Google Docs.** No Google sign-in setup, no dependency on the Docs API released 2026-09-30, real reviewer labels. Copy covers moving the result into Docs.

## Future work

- **Reply pass** inside a round.
- **Automatic rounds** until no participant proposes changes or only "Your call" items remain (the looped routing in the main spec).
- **Chat inside a doc thread** for side questions.
- **Guardrails from the main spec:** an editor-in-chief participant and a blind reader.
