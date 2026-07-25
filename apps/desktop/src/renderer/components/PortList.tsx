import { createSignal, For, Show, onMount, type JSX } from 'solid-js';
import {
  api,
  appName,
  entries,
  error,
  groupedEntries,
  isScanning,
  settings,
  settingsOpen,
  setSettingsOpen,
} from '../state/app-store.js';
import { GroupBlock } from './GroupBlock.js';
import { SettingsPop } from './SettingsPop.js';
import { ContextMenu } from './ContextMenu.js';
import type { Entry } from '@dev-tray/core';

const ICON = {
  power:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.4 7a8 8 0 1 0 11.2 0"/></svg>',
  ellipsis:
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  square:
    '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>',
  warn:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 1.5 21h21L12 3Zm0 6v5m0 3.2v.1" stroke="#fff" stroke-width="0"/><path d="M12 4.3 2.7 20.2h18.6L12 4.3Zm-.9 5.2h1.8v6h-1.8v-6Zm0 7.4h1.8v1.8h-1.8v-1.8Z"/></svg>',
};

export function PortList(): JSX.Element {
  const [leaving, setLeaving] = createSignal<Set<string>>(new Set());
  const [ctxEntry, setCtxEntry] = createSignal<Entry | null>(null);
  const [ctxPos, setCtxPos] = createSignal({ x: 0, y: 0 });
  const [ctxVisible, setCtxVisible] = createSignal(false);
  let settingsBtn: HTMLButtonElement | undefined;

  const submode = () => {
    const count = entries().length;
    if (error() && count === 0) return 'error';
    if (count === 0 && isScanning()) return 'scanning';
    if (count === 0) return 'empty';
    return 'list';
  };

  const markLeaving = (id: string) => {
    setLeaving((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 300);
  };

  onMount(() => {
    const onClick = (e: MouseEvent) => {
      if (ctxVisible()) setCtxVisible(false);
      if (
        settingsOpen() &&
        !(e.target as HTMLElement).closest('.settings-pop') &&
        !(e.target as HTMLElement).closest('.controls')
      ) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  });

  return (
    <>
      <div class="header">
        <span class="title">{appName()}</span>
        <span class="spacer" />
        <div class="controls">
          <button
            type="button"
            class="hbtn"
            title={`Quit ${appName()}`}
            innerHTML={ICON.power}
            onClick={() => api.quit()}
          />
          <button
            type="button"
            class="hbtn"
            title="Settings"
            innerHTML={ICON.ellipsis}
            ref={settingsBtn}
            onClick={(e) => {
              e.stopPropagation();
              setSettingsOpen((v) => !v);
            }}
          />
          <Show when={settingsOpen()}>
            <SettingsPop anchor={settingsBtn} onClose={() => setSettingsOpen(false)} />
          </Show>
        </div>
      </div>
      <div class="divider" />
      <Show when={submode() === 'list'}>
        <div class="list">
          <For each={[...groupedEntries().entries()]}>
            {([key, items]) => (
              <GroupBlock
                groupKey={key}
                items={items}
                leavingIds={leaving}
                setLeaving={markLeaving}
                onContextMenu={(e, entry) => {
                  e.preventDefault();
                  setCtxEntry(entry);
                  setCtxPos({ x: e.clientX, y: e.clientY });
                  setCtxVisible(true);
                }}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={submode() === 'empty'}>
        <div class="state">
          <span class="glyph empty-square" innerHTML={ICON.square} />
          <div class="title">No dev servers detected</div>
          <div class="sub">Start a dev server to see it here</div>
        </div>
      </Show>
      <Show when={submode() === 'scanning'}>
        <div class="state">
          <span class="spinner" />
          <div class="title">Scanning ports…</div>
        </div>
      </Show>
      <Show when={submode() === 'error'}>
        <div class="state">
          <span class="glyph warn" innerHTML={ICON.warn} />
          <div class="title">Scan failed</div>
          <div class="sub">{error() || 'Port scan failed'}</div>
          <button type="button" class="retry" onClick={() => api.refresh()}>
            Retry
          </button>
        </div>
      </Show>
      <ContextMenu
        entry={ctxEntry()}
        x={ctxPos().x}
        y={ctxPos().y}
        visible={ctxVisible()}
        onClose={() => setCtxVisible(false)}
        menuRef={() => {}}
      />
    </>
  );
}
