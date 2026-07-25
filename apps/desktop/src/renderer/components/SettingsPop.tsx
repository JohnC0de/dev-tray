import { For, onMount, Show, type JSX } from 'solid-js';
import { computePosition, autoUpdate, flip, shift, offset } from '@floating-ui/dom';
import { api, appName, launchAtLogin, setLaunchAtLogin, setSettings, settings, version } from '../state/app-store.js';

interface Props {
  anchor: HTMLElement | undefined;
  onClose: () => void;
}

export function SettingsPop(props: Props): JSX.Element {
  let popRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!props.anchor || !popRef) return;
    const cleanup = autoUpdate(props.anchor, popRef, () => {
      void computePosition(props.anchor!, popRef!, {
        placement: 'bottom-end',
        middleware: [offset(8), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        Object.assign(popRef!.style, { left: `${x}px`, top: `${y}px` });
      });
    });
    return cleanup;
  });

  return (
    <div class="settings-pop" ref={popRef} onClick={(e) => e.stopPropagation()}>
      <div class="ver">
        {appName()} v{version()}
      </div>
      <div>
        <div class="sub">Refresh interval</div>
        <div class="segmented">
          <For each={[2, 5, 10, 30] as const}>
            {(sec) => (
              <button
                type="button"
                classList={{ active: settings().refreshInterval === sec }}
                onClick={async () => {
                  const actual = await api.setRefreshInterval(sec);
                  setSettings((s) => ({ ...s, refreshInterval: actual }));
                }}
              >
                {sec}s
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="row">
        <span class="label">Launch at Login</span>
        <label class="switch">
          <input
            type="checkbox"
            checked={launchAtLogin()}
            onChange={async (e) => {
              const actual = await api.setLaunchAtLogin(e.currentTarget.checked);
              setLaunchAtLogin(actual);
            }}
          />
          <span class="track" />
          <span class="thumb" />
        </label>
      </div>
    </div>
  );
}
