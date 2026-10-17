import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      exclude: ['tailwindcss', '@tailwindcss/oxide'],
    },
    server: {
      fs: {
        strict: true,
        allow: [path.resolve(__dirname, '.')],
        deny: ['.env', '.env.*', '.git', 'node_modules/.cache', 'novels/**', 'uploads/**', 'vendor/**'],
      },
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/node_modules/**',
          '**/vendor/**',
          '**/novels/**',
          '**/uploads/**',
          '**/.git/**',
          '**/dist/**',
          '**/.local/**',
          '**/pnpm/**',
          '**/.pnpm/**',
          '**/*.txt',
          '**/*.db',
          '**/*.sqlite*',
        ],
      },
    },
  };
});
