import { afterEach, describe, expect, it } from "vitest";
import {
  aiConfig,
  aiConfigured,
  deploymentDiagnostics,
  detectDeployment,
  googleConfigured,
} from "./platform.server";

const mode = (values: Record<string, string>) => detectDeployment((key) => values[key]);
const keys = [
  "LOVABLE_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_DRIVE_API_KEY",
  "GOOGLE_SHEETS_API_KEY",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
];
const saved = new Map(keys.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const clearServices = () => {
  for (const key of keys) delete process.env[key];
};

describe("dual-mode platform", () => {
  it("keeps cloud as a safe default without optional keys", () => {
    expect(mode({}).mode).toBe("cloud");
    clearServices();
    expect(googleConfigured("drive")).toBe(false);
    expect(googleConfigured("sheets")).toBe(false);
    expect(aiConfigured()).toBe(false);
    expect(aiConfig("test")).toBeNull();
    expect(() => deploymentDiagnostics()).not.toThrow();
  });
  it("honors runtime cloud over conflicting build-time self-host flags", () => {
    expect(
      mode({
        DEPLOYMENT_MODE: " CLOUD ",
        VITE_DEPLOYMENT_MODE: "selfhost",
        VITE_SELF_HOSTED: "true",
      }).mode,
    ).toBe("cloud");
    expect(mode({ DEPLOYMENT_MODE: "local", VITE_DEPLOYMENT_MODE: "cloud" }).mode).toBe("selfhost");
    expect(mode({ DEPLOYMENT_MODE: "", VITE_DEPLOYMENT_MODE: "selfhost" }).mode).toBe("selfhost");
    expect(mode({ VITE_DEPLOYMENT_MODE: "cloud", VITE_SELF_HOSTED: "true" }).mode).toBe("cloud");
    expect(mode({ VITE_SELF_HOSTED: "1" }).mode).toBe("selfhost");
  });
  it("uses specific Docker evidence, not generic production or localhost", () => {
    expect(
      mode({
        STORAGE_ROOT: "/var/lib/pcb-checker/storage",
        SUPABASE_URL: "http://host.docker.internal:8000",
      }).mode,
    ).toBe("selfhost");
    expect(mode({ NODE_ENV: "production", SUPABASE_URL: "http://localhost:8000" }).mode).toBe(
      "cloud",
    );
    expect(() => mode({ SUPABASE_URL: "not a URL" })).not.toThrow();
  });
  it("ignores incomplete OAuth and malformed service-account configuration", () => {
    clearServices();
    process.env["GOOGLE_REFRESH_TOKEN"] = "test-only";
    process.env["GOOGLE_SERVICE_ACCOUNT_JSON"] = "{invalid";
    expect(googleConfigured("drive")).toBe(false);
    process.env["GOOGLE_SERVICE_ACCOUNT_JSON"] =
      '{"client_email":"service@example.test","private_key":"-----BEGIN PRIVATE KEY-----fixture"}';
    expect(googleConfigured("drive")).toBe(true);
  });
  it("preserves Lovable connectors and does not expose keys in public diagnostics", () => {
    clearServices();
    process.env["LOVABLE_API_KEY"] = "test-only-lovable";
    process.env["GOOGLE_SHEETS_API_KEY"] = "test-only-sheets";
    expect(googleConfigured("sheets")).toBe(true);
    expect(googleConfigured("drive")).toBe(false);
    expect(aiConfig("google/test")?.mode).toBe("lovable");
    const json = JSON.stringify(deploymentDiagnostics());
    expect(json).not.toContain("test-only");
    expect(json).not.toContain("apiKey");
  });
});
