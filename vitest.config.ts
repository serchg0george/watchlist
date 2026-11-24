import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Component tests only; domain tests stay on node --test (npm test runs both).
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify("test"),
    __BUILD_TIME__: JSON.stringify("2026-01-01T00:00:00.000Z")
  },
  plugins: [react()],
  test: { environment: "jsdom", include: ["tests/react/**/*.test.tsx"] }
});
