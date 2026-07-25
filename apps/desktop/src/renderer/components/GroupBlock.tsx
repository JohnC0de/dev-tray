import { For, Show, type JSX } from 'solid-js';
import type { Entry } from '@dev-tray/core';
import { api, collapsedGroups, toggleGroup } from '../state/app-store.js';
import { ICON } from './helpers.js';
import { PortRow } from './PortRow.js';

interface Props {
  groupKey: string;
  items: Entry[];
  onContextMenu: (e: MouseEvent, entry: Entry) => void;
  leavingIds: () => Set<string>;
  setLeaving: (id: string) => void;
}

export function GroupBlock(props: Props): JSX.Element {
  const collapsed = () => collapsedGroups().has(props.groupKey);
  const flat = () => props.items.length < 2;

  return (
    <Show when={!flat()} fallback={
      <For each={props.items}>
        {(entry) => (
          <PortRow
            entry={entry}
            onContextMenu={props.onContextMenu}
            onLeave={() => props.setLeaving(entry.id)}
          />
        )}
      </For>
    }>
      <section class="group-block" classList={{ collapsed: collapsed() }} data-group={props.groupKey}>
        <div
          class="group-head"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.icon-btn')) return;
            toggleGroup(props.groupKey);
          }}
        >
          <span class="group-chevron" innerHTML={ICON.chevron} />
          <span class="group-title">
            <span class="group-name" title={props.items[0]?.projectName}>
              {props.items[0]?.projectName}
            </span>
            <span class="group-dot">·</span>
            <span class="group-count">{props.items.length}</span>
          </span>
          <button
            type="button"
            class="icon-btn ghost destructive stop"
            title="Kill group"
            innerHTML={ICON.stop}
            onClick={(e) => {
              e.stopPropagation();
              for (const entry of props.items) {
                api.killPort(entry.pid, entry.port);
                props.setLeaving(entry.id);
              }
            }}
          />
        </div>
        <div class="group-body">
          <For each={props.items}>
            {(entry) => (
              <Show when={!props.leavingIds().has(entry.id)}>
                <PortRow
                  entry={entry}
                  onContextMenu={props.onContextMenu}
                  onLeave={() => props.setLeaving(entry.id)}
                />
              </Show>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
