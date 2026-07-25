import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import solid from 'vite-plugin-solid';

const coreEntry = resolve(__dirname, '../../packages/core/src/index.ts');
const bundleCore = { exclude: ['@dev-tray/core'] };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(bundleCore)],
    resolve: {
      alias: {
        '@dev-tray/core': coreEntry,
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [solid()],
    resolve: {
      alias: {
        '@dev-tray/core': coreEntry,
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
