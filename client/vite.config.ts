
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({ 
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Real de Catorce Logística',
        short_name: 'R14 App',
        description: 'Gestión de Choferes R14',
        theme_color: '#0ea5e9',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: [
      'uropygial-conservational-joy.ngrok-free.dev',
      '.ngrok-free.dev',
      'localhost',
      '127.0.0.1'
    ],
    port: 5175,
    proxy: {
        '/api': 'http://127.0.0.1:3002'
    }
  }
})
