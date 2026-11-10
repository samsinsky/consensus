// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { Proposal } from '../../src/shared/types.js';
import { placeProposals, shownOption } from '../../src/web/doc/anchoring.js';
import { docExtensions } from '../../src/web/doc/DocEditor.js';
import { editorIndex } from '../../src/web/doc/editorIndex.js';
import { ProposalHighlights, showProposals } from '../../src/web/doc/proposalDecorations.js';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());
const make = (md: string) => (editor = new Editor({ element: document.createElement('div'), extensions: [...docExtensions(), ProposalHighlights], content: md, contentType: 'markdown' }));

const prop = (over: Partial<Proposal>): Proposal => ({
  id: 'P1', round: 1, authors: ['a'], quote: 'q', prefix: '', suffix: '', replacement: 'r', reason: 'why', status: 'open', replies: [], ...over,
});

describe('placeProposals', () => {
  it('anchors open proposals, groups overlaps in text order, and lists missing ones as out of date', () => {
    const ed = make('I have gone deep on LLMs. We ship fast.');
    const { groups, stale } = placeProposals([
      prop({ id: 'P3', quote: 'ship fast' }),
      prop({ id: 'P1', quote: 'gone deep on' }),
      prop({ id: 'P2', quote: 'deep on LLMs', replies: [{ from: 'b', stance: 'your_call', text: '', at: '' }] }),
      prop({ id: 'P4', quote: 'not here' }),
      prop({ id: 'P5', quote: 'We', status: 'accepted' }),
    ], editorIndex(ed.state.doc));
    expect(groups.map((g) => g.options.map((o) => o.proposal.id))).toEqual([['P1', 'P2'], ['P3']]);
    expect(groups[0]).toMatchObject({ key: 'P1', yourCall: true });
    expect(ed.state.doc.textBetween(groups[1].options[0].from, groups[1].options[0].to)).toBe('ship fast');
    expect(stale.map((p) => p.id)).toEqual(['P4']);
  });
});

describe('placeProposals by changed words', () => {
  it('groups by the words each suggestion changes, not by how much it quotes', () => {
    const ed = make('I think that birds can fly.');
    const { groups } = placeProposals([
      prop({ id: 'P1', quote: 'I think that', replacement: 'We think that' }),
      prop({ id: 'P2', quote: 'think that birds', replacement: 'think that penguins' }),
      prop({ id: 'P3', quote: 'that birds can', replacement: 'that penguins can' }),
    ], editorIndex(ed.state.doc));
    expect(groups.map((g) => g.options.map((o) => o.proposal.id))).toEqual([['P1'], ['P2', 'P3']]);
    expect(groups[0].options[0]).toMatchObject({ start: 0, end: 12 });
  });
});

describe('shownOption', () => {
  it('shows the picked option, else the first', () => {
    const ed = make('I have gone deep on LLMs.');
    const { groups } = placeProposals([prop({ id: 'P1', quote: 'gone deep on' }), prop({ id: 'P2', quote: 'deep on' })], editorIndex(ed.state.doc));
    expect(shownOption(groups[0], new Set()).proposal.id).toBe('P1');
    expect(shownOption(groups[0], new Set(['P2'])).proposal.id).toBe('P2');
  });
});

describe('showProposals', () => {
  it('strikes the quoted words and shows the replacement after them without changing the document', () => {
    const ed = make('I have gone deep on LLMs.');
    const before = ed.getMarkdown();
    const { groups } = placeProposals([prop({ id: 'P1', quote: 'gone deep on', replacement: 'gained' })], editorIndex(ed.state.doc));
    const o = groups[0].options[0];
    showProposals(ed, [{ id: 'P1', from: o.from, to: o.to, replacement: 'gained', provider: 'codex', focused: true }]);
    const old = ed.view.dom.querySelector('[data-proposal="P1"].prop-old')!;
    const added = ed.view.dom.querySelector('[data-proposal="P1"].prop-new')!;
    expect(old.textContent).toBe('gone deep on');
    expect(old.className).toContain('codex');
    expect(old.className).toContain('focused');
    expect(added.textContent).toBe('gained');
    expect(ed.getMarkdown()).toBe(before);
    showProposals(ed, []);
    expect(ed.view.dom.querySelector('[data-proposal]')).toBeNull();
  });

  it('fades the other suggestions while one is focused, and none when nothing is', () => {
    const ed = make('I have gone deep on LLMs.');
    const { groups } = placeProposals([prop({ id: 'P1', quote: 'gone deep on' }), prop({ id: 'P2', quote: 'LLMs' })], editorIndex(ed.state.doc));
    const shown = (focused?: string) =>
      groups.map((g) => ({ id: g.key, from: g.options[0].from, to: g.options[0].to, replacement: 'x', provider: 'claude' as const, focused: g.key === focused }));
    const cls = (id: string) => ed.view.dom.querySelector(`[data-proposal="${id}"].prop-old`)!.className;
    showProposals(ed, shown('P1'));
    expect(cls('P1')).not.toContain('dim');
    expect(cls('P2')).toContain('dim');
    showProposals(ed, shown());
    expect(cls('P2')).not.toContain('dim');
  });

  it('keeps the focused strike whole where a faded suggestion overlaps it', () => {
    const ed = make('replaces days of work with a 2-minute import here');
    const { groups } = placeProposals(
      [prop({ id: 'P1', quote: 'replaces days of work with a 2-minute import' }), prop({ id: 'P2', quote: 'with a 2-minute import here' })],
      editorIndex(ed.state.doc),
    );
    const all = groups.flatMap((g) => g.options);
    const shown = (focused: string) =>
      all.map((o) => ({ id: o.proposal.id, from: o.from, to: o.to, replacement: '', provider: 'claude' as const, focused: o.proposal.id === focused }));
    const text = (sel: string) => [...ed.view.dom.querySelectorAll(sel)].map((e) => e.textContent).join('|');
    showProposals(ed, shown('P1'));
    expect(text('.prop-old.focused')).toBe('replaces days of work with a 2-minute import');
    expect(text('.prop-old.dim')).toBe(' here');
    expect(ed.view.dom.querySelector('.prop-old.focused.dim')).toBeNull();
  });
});
