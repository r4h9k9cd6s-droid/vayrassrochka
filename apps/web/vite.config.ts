import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'ВайРассрочка',
        short_name: 'ВайРассрочка',
        description: 'Личный учёт рассрочек и лента настоящих покупок людей',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        background_color: '#EDF3EE',
        theme_color: '#0F3B2B',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,woff2}'] },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
