import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

// Vite transforms TSX/JSX through its built-in esbuild pipeline.
// Keep the production build independent from @vitejs/plugin-react so a
// missing optional dev package cannot block Cloudflare deployment.
export default defineConfig({
  plugins: [cloudflare()],
});
