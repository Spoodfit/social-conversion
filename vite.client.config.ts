import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'import.meta.env.VITE_UI_ONLY': JSON.stringify('true'),
  },
});
