import fs from "node:fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const wailsConfigPath = path.resolve(__dirname, "..", "wails.json")
const wailsConfig = JSON.parse(fs.readFileSync(wailsConfigPath, "utf-8")) as {
  info: {
    productName: string
    productVersion: string
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_NAME__: JSON.stringify(wailsConfig.info.productName),
    __APP_VERSION__: JSON.stringify(wailsConfig.info.productVersion),
  },
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("scheduler")) {
              return "vendor-react"
            }
            if (id.includes("virtua")) {
              return "vendor-virtua"
            }
            if (id.includes("lucide-react")) {
              return "vendor-icons"
            }
          }

          if (id.includes("/src/components/DatabaseView") || id.includes("/src/hooks/useSavedAccountsModel")) {
            return "workspace-saved"
          }
          if (id.includes("/src/components/MediaList") || id.includes("/src/hooks/useMediaListModel")) {
            return "workspace-media"
          }
          if (id.includes("/src/components/SettingsPage") || id.includes("/src/components/DebugLoggerPage")) {
            return "workspace-panels"
          }

          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
