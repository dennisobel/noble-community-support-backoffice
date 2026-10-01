import { describe, expect, it } from "vitest";
import { loadConfig, usingDevJwtSecret } from "../src/config";

describe("config", () => {
  it("treats blank values copied from .env.example as unset", () => {
    const cfg = loadConfig({
      NODE_ENV: "development",
      JWT_ACCESS_SECRET: "",
      SETUP_CODE: "",
      SMTP_HOST: "  ",
      APP_URL: "",
    });
    expect(usingDevJwtSecret(cfg)).toBe(true);
    expect(cfg.auth.setupCode).toBeUndefined();
    expect(cfg.mail.enabled).toBe(false);
    expect(cfg.appUrl).toBe("http://localhost:5173");
  });

  it("still refuses a blank JWT secret in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: "",
        SETUP_CODE: "setup-code",
      })
    ).toThrow(/JWT_ACCESS_SECRET/);
  });
});
