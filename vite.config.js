import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Se actualiza sola: un push a main y la app queda al día en la
      // compu y en el teléfono. Ese era el punto de todo el cambio.
      registerType: 'autoUpdate',
      includeAssets: ['icono.png'],

      manifest: {
        name: 'Gestión Combustibles',
        short_name: 'Combustibles',
        description: 'Ventas, stock y fiados de nafta y gasoil',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0F0E0C',
        theme_color: '#0A0908',
        icons: [
          { src: 'icono.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
        ],
      },

      workbox: {
        // Sólo el armazón de la app: HTML, JS, CSS e ícono.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',

        // Los datos NUNCA se cachean. Mostrar una deuda vieja como si
        // fuera la actual es peor que no mostrar nada: hay que ver la
        // plata real, no la que había la última vez que hubo señal.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
          {
            // La tipografía sí, que es pesada y no cambia nunca.
            urlPattern: ({ url }) => url.hostname.includes('fonts.g'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fuentes',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      devOptions: { enabled: false },
    }),
  ],
  // host: true expone el server a la red local, así se puede probar
  // desde el teléfono sin deployar. Sólo afecta a `npm run dev`.
  server: { port: 5173, host: true },
  build: { outDir: 'dist' },
});
