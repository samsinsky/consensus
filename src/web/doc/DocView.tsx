import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkFile } from '../../shared/attachmentRules.js';
import { RESOLVED } from '../../shared/proposals.js';
import type { ModelOption, ProviderDefaults, ProviderId, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { AttachmentChip } from '../components/AttachmentChip.js';
import { ThreadTitle } from '../components/ThreadTitle.js';
import { placeProposals, shownOption, type Group } from './anchoring.js';
import { copyFormatted } from './clipboard.js';
import { DocEditor } from './DocEditor.js';
import { editorIndex } from './editorIndex.js';
import { HistoryMenu } from './HistoryMenu.js';
import { applyReplacement } from './inlineMarkdown.js';
import { Margin } from './Margin.js';
import { NoteCard } from './NoteCard.js';
import { ProposalCard, StaleCard } from './ProposalCard.js';
import { ProposalHighlights, showProposals } from './proposalDecorations.js';
import { ResolvedList } from './ResolvedList.js';
import { ReviewBar } from './ReviewBar.js';
import { useAutoGrow } from '../useAutoGrow.js';

const SAVE_DELAY = 1000;
const highlights = [ProposalHighlights];

type Props = {
  thread: Thread;
  activity: Record<string, string>;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
};

type Pending = { markdown?: string; brief?: string };

export function DocView({ thread, activity, models, defaults }: Props) {
  const doc = thread.doc!;
  const [editor, setEditor] = useState<Editor>();
  const [version, setVersion] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string>();
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [brief, setBrief] = useState(doc.brief);
  const briefBox = useRef<HTMLTextAreaElement>(null);
  const docPane = useRef<HTMLDivElement>(null);
  useAutoGrow(briefBox, brief);
  const pending = useRef<Pending>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const revision = useRef(doc.revision);
  const inFlight = useRef<Promise<boolean>>(undefined);
  const filePicker = useRef<HTMLInputElement>(null);

  /** Saves queued edits now, after any save already in flight. Returns false when a save failed. */
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    const previous = inFlight.current;
    const run = (async (): Promise<boolean> => {
      if (previous) await previous;
      const body = pending.current;
      if (body.markdown === undefined && body.brief === undefined) return true;
      pending.current = {};
      const sentAt = revision.current;
      setSaveState('saving');
      try {
        await api.saveDoc(thread.id, { revision: sentAt, ...body });
        setSaveState('saved');
        setError(undefined);
        return true;
      } catch (e) {
        // Keep the edits only while they still apply; a restore replaced the text they were made against.
        if (revision.current === sentAt) pending.current = { ...body, ...pending.current };
        setSaveState('error');
        setError((e as Error).message);
        return false;
      }
    })();
    inFlight.current = run;
    return run;
  }, [thread.id]);

  const queue = (patch: Pending) => {
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  };

  // A restore replaced the text on the server: drop edits queued against the old text.
  useEffect(() => {
    if (doc.revision === revision.current) return;
    revision.current = doc.revision;
    clearTimeout(timer.current);
    pending.current = {};
    setSaveState('saved');
    setVersion((v) => v + 1);
  }, [doc.revision]);

  // Save anything queued when leaving the doc.
  useEffect(() => () => void flush(), [flush]);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => {
      editor.off('update', bump);
    };
  }, [editor]);

  const layout = useMemo(
    () => (editor ? placeProposals(doc.proposals, editorIndex(editor.state.doc)) : { groups: [], stale: [] }),
    // version tracks edits to the editor's document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, version, doc.proposals],
  );

  const providerOf = (id: string) => thread.participants.find((p) => p.id === id)?.provider ?? 'claude';

  useEffect(() => {
    if (!editor) return;
    showProposals(editor, layout.groups.map((g) => {
      const o = shownOption(g, picked);
      return {
        id: o.proposal.id, from: o.from, to: o.to, replacement: o.proposal.replacement,
        provider: providerOf(o.proposal.authors[0]),
        focused: g.options.some((x) => x.proposal.id === focused),
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, layout, picked, focused]);

  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      setError(undefined);
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const accept = (g: Group, id: string, replacement: string) => attempt(async () => {
    const o = g.options.find((x) => x.proposal.id === id);
    if (!editor || !o) return;
    applyReplacement(editor, o, replacement);
    await api.updateProposal(thread.id, id, {
      status: 'accepted',
      replacement: replacement !== o.proposal.replacement ? replacement : undefined,
      notChosen: g.options.filter((x) => x.proposal.id !== id).map((x) => x.proposal.id),
    });
  });

  const pick = (g: Group, id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const o of g.options) next.delete(o.proposal.id);
      next.add(id);
      return next;
    });

  const latest = doc.rounds.at(-1);
  const running = !!latest && Object.values(latest.notes).some((n) => n.status === 'running');

  const send = () => attempt(async () => {
    if (!(await flush())) return;
    await api.startRound(thread.id);
  });

  const copy = () => attempt(async () => {
    if (!editor) return;
    await copyFormatted(editor.getHTML(), editor.getText({ blockSeparator: '\n\n' }).replace(/\n{3,}/g, '\n\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });

  const attach = (files: File[]) => attempt(async () => {
    const ids = (doc.briefAttachments ?? []).map((a) => a.id);
    for (const file of files) {
      const problem = checkFile(file.name, file.size);
      if (problem) throw new Error(problem);
      ids.push((await api.uploadAttachment(thread.id, file)).id);
    }
    if (!(await flush())) return;
    await api.saveDoc(thread.id, { revision: revision.current, briefAttachmentIds: ids });
  });

  const detach = (id: string) => attempt(async () => {
    if (!(await flush())) return;
    await api.saveDoc(thread.id, { revision: revision.current, briefAttachmentIds: (doc.briefAttachments ?? []).map((a) => a.id).filter((x) => x !== id) });
  });

  const topOf = (pos: number) => {
    try {
      if (!editor) return 0;
      // Document content coordinates: unchanged by scrolling the document pane.
      const pane = docPane.current;
      return editor.view.coordsAtPos(pos).top - (pane ? pane.getBoundingClientRect().top - pane.scrollTop : 0);
    } catch {
      return 0;
    }
  };

  const reviewers = thread.participants.filter((p) => doc.rounds.some((r) => r.participants.includes(p.id)));
  const header = (
    <>
      {reviewers.map((p) => (
        <NoteCard
          key={p.id}
          participant={p}
          all={thread.participants}
          rounds={doc.rounds.filter((r) => r.participants.includes(p.id))}
          activity={activity[`doc:${p.id}`]}
          roundRunning={running}
          latestRound={latest?.n ?? 0}
          onRetry={() => attempt(() => api.retryReview(thread.id, p.id))}
        />
      ))}
      {layout.stale.map((p) => (
        <StaleCard key={p.id} proposal={p} participants={thread.participants} onDismiss={(id) => attempt(() => api.updateProposal(thread.id, id, { status: 'dismissed' }))} />
      ))}
    </>
  );
  const items = layout.groups.map((g) => {
    const shown = shownOption(g, picked);
    return {
      key: g.key,
      anchor: shown.from,
      node: (
        <ProposalCard
          group={g}
          shown={shown.proposal.id}
          participants={thread.participants}
          focused={g.options.some((x) => x.proposal.id === focused)}
          onFocus={() => setFocused(shown.proposal.id)}
          onPickOption={(id) => pick(g, id)}
          onAccept={(id, text) => accept(g, id, text)}
          onReject={(ids) => attempt(async () => {
            for (const id of ids) await api.updateProposal(thread.id, id, { status: 'rejected' });
          })}
          onReply={(id, text) => api.replyToProposal(thread.id, id, text)}
          onEditReplacement={(id, text) => attempt(() => api.updateProposal(thread.id, id, { replacement: text }))}
        />
      ),
    };
  });

  return (
    <section className="thread-view doc-view">
      <header className="thread-head">
        <ThreadTitle thread={thread} />
      </header>
      <div className="doc-scroll">
        <div className="doc-pane" ref={docPane}>
          <div className="doc-main">
            <div className="doc-tools">
              {saveState === 'error' && <span className="not-saved" title={error}>Not saved</span>}
              <HistoryMenu rounds={doc.rounds} onRestore={async (n) => {
                clearTimeout(timer.current);
                pending.current = {};
                await api.restore(thread.id, n);
              }} />
              <button className="ghost icon-btn" title="Copy" aria-label="Copy" onClick={copy}>
                {copied ? 'Copied' : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                )}
              </button>
            </div>
            <DocEditor
              markdown={doc.markdown}
              revision={doc.revision}
              extensions={highlights}
              onChange={(md) => queue({ markdown: md })}
              onReady={setEditor}
              onPick={setFocused}
            />
            {error && <p className="error-inline">{error}</p>}
          </div>
        </div>
        <Margin
          header={header}
          footer={<ResolvedList proposals={doc.proposals.filter((p) => RESOLVED.includes(p.status))} participants={thread.participants} />}
          items={items}
          focused={layout.groups.find((g) => g.options.some((x) => x.proposal.id === focused))?.key}
          topOf={topOf}
          version={version + doc.proposals.length}
        />
      </div>
      <div className="doc-composer">
        <ReviewBar
          thread={thread}
          models={models}
          defaults={defaults}
          activity={activity}
          running={running}
        />
        {doc.briefAttachments?.length ? (
          <div className="att-row">
            {doc.briefAttachments.map((a) => (
              <AttachmentChip key={a.id} threadId={thread.id} name={a.name} size={a.size} attachment={a} onRemove={() => detach(a.id)} />
            ))}
          </div>
        ) : null}
        <div className="input-wrap">
          <button className="ghost attach" onClick={() => filePicker.current?.click()} title="Attach files to the brief" aria-label="Attach files to the brief">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input ref={filePicker} type="file" multiple hidden onChange={(e) => {
            attach([...(e.target.files ?? [])]);
            e.target.value = '';
          }} />
          <textarea
            ref={briefBox}
            className="brief-input"
            rows={1}
            placeholder="Brief for reviewers: what this is, who reads it, any limits. Cmd+Enter to send."
            value={brief}
            onChange={(e) => {
              setBrief(e.target.value);
              queue({ brief: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !running && doc.included.length) {
                e.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <button className="send-btn stop" onClick={() => attempt(() => api.stopRound(thread.id))} title="Stop" aria-label="Stop">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            </button>
          ) : (
            <button className="send-btn" disabled={!doc.included.length} onClick={send} title="Send for review (Cmd+Enter)" aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5" />
                <path d="m5 12 7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
