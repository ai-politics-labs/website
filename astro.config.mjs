// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://aiparty.kr',

  vite: {
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        external: [/^\/revote\//],
        onwarn(warning, warn) {
          // /revote/* modules are served as public static files at runtime;
          // suppress Rollup's unresolved-import warning for them.
          if (
            warning.code === "UNRESOLVED_IMPORT" &&
            warning.exporter &&
            warning.exporter.startsWith("/revote/")
          ) return;
          warn(warning);
        },
      },
    },
  },
});