import { defineConfig } from "@playwright/test";
import path from "node:path";
const backend = path.resolve("../backend");
const python = path.join(
  backend,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  reporter: "list",
  webServer: [
    {
      command: `"${python}" -m app.testserver`,
      cwd: backend,
      url: "http://127.0.0.1:8001/api/v1/health",
      env: {
        DATABASE_URL: "sqlite:///./chindi-e2e.db",
        ALLOW_SIGNUPS: "true",
        AUTH_RATE_LIMIT: "100",
        APP_URL: "http://127.0.0.1:5174",
        CORS_ORIGINS: '["http://127.0.0.1:5174","http://localhost:5174"]',
      },
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVERS === "1",
    },
    {
      command: "npm run build && npm run preview -- --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      env: { CHINDI_API_URL: "http://127.0.0.1:8001" },
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVERS === "1",
    },
  ],
});
