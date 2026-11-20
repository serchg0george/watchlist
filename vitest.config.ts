import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Component tests only; domain tests stay on node --test (npm test runs both).
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", include: ["tests/react/**/*.test.tsx"] }
});
