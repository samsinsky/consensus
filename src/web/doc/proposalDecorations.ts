import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ProviderId } from '../../shared/types.js';

export type Shown = { id: string; from: number; to: number; replacement: string; provider: ProviderId; focused: boolean };

const key = new PluginKey<DecorationSet>('consensusProposals');

/** Draws proposals over the text. They are decorations, never part of the document. */
export const ProposalHighlights = Extension.create({
  name: 'proposalHighlights',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => (tr.getMeta(key) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

export function showProposals(editor: Editor, shown: Shown[]): void {
  const tr = editor.state.tr.setMeta(key, build(editor.state.doc, shown)).setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

function build(doc: PMNode, shown: Shown[]): DecorationSet {
  const decorations: Decoration[] = [];
  // With one suggestion focused, the rest fade, so its full strike reads even where others overlap it.
  const focus = shown.find((s) => s.focused);
  for (const s of shown) {
    const cls = `${s.provider}${s.focused ? ' focused' : focus ? ' dim' : ''}`;
    // ProseMirror merges overlapping decorations into one span with both classes, so a faded one would fade the
    // focused strike too. Faded ranges skip the focused one's words.
    for (const [from, to] of focus && !s.focused ? outside(s, focus) : [[s.from, s.to]]) {
      decorations.push(Decoration.inline(from, to, { class: `prop-old ${cls}`, 'data-proposal': s.id }));
    }
    if (s.replacement) {
      decorations.push(
        Decoration.widget(s.to, () => {
          const el = document.createElement('span');
          el.className = `prop-new ${cls}`;
          el.dataset.proposal = s.id;
          el.textContent = s.replacement;
          return el;
        }, { side: 1, key: `${s.id}:${cls}:${s.replacement}` }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

/** The parts of a range that fall outside another. */
function outside(r: { from: number; to: number }, cut: { from: number; to: number }): [number, number][] {
  if (cut.to <= r.from || cut.from >= r.to) return [[r.from, r.to]];
  const parts: [number, number][] = [];
  if (r.from < cut.from) parts.push([r.from, cut.from]);
  if (cut.to < r.to) parts.push([cut.to, r.to]);
  return parts;
}
