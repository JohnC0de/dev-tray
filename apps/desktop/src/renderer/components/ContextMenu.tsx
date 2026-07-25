import { Show, type JSX } from 'solid-js';
import { computePosition, flip, shift, offset } from '@floating-ui/dom';
import type { Entry } from '@dev-tray/core';
import { api } from '../state/app-store.js';
import { copyEntryUrl, killRow, openEntry } from './helpers.js';

interface Props {
  entry: Entry | null;
  x: number;
  y: number;
  visible: boolean;
  onClose: () => void;
  menuRef: (el: HTMLDivElement) => void;
}

export function ContextMenu(props: Props): JSX.Element {
  let menuEl: HTMLDivElement | undefined;

  const position = () => {
    if (!menuEl || !props.visible) return;
    const virtual = {
      getBoundingClientRect: () =>
        ({
          x: props.x,
          y: props.y,
          width: 0,
          height: 0,
          top: props.y,
          left: props.x,
          right: props.x,
          bottom: props.y,
        }) as DOMRect,
    };
    void computePosition(virtual, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 6 })],
    }).then(({ x, y }) => {
      Object.assign(menuEl!.style, { left: `${x}px`, top: `${y}px` });
    });
  };

  return (
    <Show when={props.visible && props.entry}>
      {(entry) => (
        <div
          class="context-menu"
          ref={(el) => {
            menuEl = el;
            props.menuRef(el);
            position();
          }}
        >
          <button type="button" onClick={() => { props.onClose(); copyEntryUrl(entry()); }}>
            Copy URL
          </button>
          <button type="button" onClick={() => { props.onClose(); api.copy(String(entry().port)); }}>
            Copy Port
          </button>
          <div class="sep" />
          <button type="button" onClick={() => { props.onClose(); openEntry(entry()); }}>
            Open in Browser
          </button>
          <div class="sep" />
          <button
            type="button"
            disabled={!entry().cwd && !entry().gitRoot}
            onClick={() => {
              props.onClose();
              api.openInExplorer(entry().cwd, entry().gitRoot);
            }}
          >
            Open in Explorer
          </button>
          <button
            type="button"
            disabled={!entry().cwd && !entry().gitRoot}
            onClick={() => {
              props.onClose();
              api.openInEditor(entry().cwd, entry().gitRoot);
            }}
          >
            Open in Editor
          </button>
          <div class="sep" />
          <button
            type="button"
            class="destructive"
            onClick={() => {
              props.onClose();
              killRow(entry(), () => {});
            }}
          >
            Kill Server
          </button>
        </div>
      )}
    </Show>
  );
}
