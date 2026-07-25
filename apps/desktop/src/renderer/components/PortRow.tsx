import { Show, type JSX } from 'solid-js';
import type { Entry } from '@dev-tray/core';
import { formatUptime, healthClass, ICON, killRow, openEntry } from './helpers.js';

interface Props {
  entry: Entry;
  onContextMenu: (e: MouseEvent, entry: Entry) => void;
  onLeave: () => void;
}

export function PortRow(props: Props): JSX.Element {
  const branchName = () => props.entry.branchCurrent;
  return (
    <div
      class="port-row group-row"
      data-id={props.entry.id}
      onContextMenu={(e) => props.onContextMenu(e, props.entry)}
    >
      <span
        class="branch"
        style={{ display: branchName() ? '' : 'none' }}
        innerHTML={`${ICON.branch}<span>${branchName() ?? ''}</span>`}
      />
      <span class={`dot ${healthClass(props.entry)}`} />
      <span class="port-num">:{props.entry.port}</span>
      <Show when={props.entry.framework}>
        <span class="tag framework">{props.entry.framework}</span>
      </Show>
      <Show when={props.entry.branchDrifted}>
        <span class="tag drift">drift</span>
      </Show>
      <span class="group-row-spacer" />
      <span class="uptime">{formatUptime(props.entry.startTime)}</span>
      <span class="row-actions-divider" />
      <button
        type="button"
        class="icon-btn ghost"
        title="Open"
        innerHTML={ICON.open}
        onClick={(e) => {
          e.stopPropagation();
          openEntry(props.entry);
        }}
      />
      <button
        type="button"
        class="icon-btn ghost destructive"
        title="Kill"
        innerHTML={ICON.close}
        onClick={(e) => {
          e.stopPropagation();
          killRow(props.entry, props.onLeave);
        }}
      />
    </div>
  );
}
