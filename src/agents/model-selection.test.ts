import { describe, expect, it } from "vitest";

import type { ClawdbotConfig } from "../config/config.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import type { ModelCatalogEntry } from "./model-catalog.js";
import {
  resolveConfiguredModelRef,
  resolveThinkingDefault,
} from "./model-selection.js";

describe("resolveConfiguredModelRef", () => {
  it("parses provider/model from agent.model.primary", () => {
    const cfg = {
      agent: { model: { primary: "openai/gpt-4.1-mini" } },
    } satisfies ClawdbotConfig;

    const resolved = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });

    expect(resolved).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
  });

  it("falls back to anthropic when agent.model.primary omits provider", () => {
    const cfg = {
      agent: { model: { primary: "claude-opus-4-5" } },
    } satisfies ClawdbotConfig;

    const resolved = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });

    expect(resolved).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-5",
    });
  });

  it("falls back to defaults when agent.model is missing", () => {
    const cfg = {} satisfies ClawdbotConfig;

    const resolved = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });

    expect(resolved).toEqual({
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
    });
  });

  it("resolves agent.model aliases when configured", () => {
    const cfg = {
      agent: {
        model: { primary: "Opus" },
        models: {
          "anthropic/claude-opus-4-5": { alias: "Opus" },
        },
      },
    } satisfies ClawdbotConfig;

    const resolved = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });

    expect(resolved).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-5",
    });
  });

  it("still resolves legacy agent.model string", () => {
    const cfg = {
      agent: { model: "openai/gpt-4.1-mini" },
    } satisfies ClawdbotConfig;

    const resolved = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });

    expect(resolved).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
  });
});

describe("resolveThinkingDefault", () => {
  const emptyCfg = {} satisfies ClawdbotConfig;
  const reasoningCatalog: ModelCatalogEntry[] = [
    {
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      provider: "anthropic",
      reasoning: true,
    },
    {
      id: "gemini-3-flash",
      name: "Gemini 3 Flash",
      provider: "google",
      reasoning: true,
    },
  ];

  it("returns configured thinkingDefault when set", () => {
    const cfg = { agent: { thinkingDefault: "high" } } satisfies ClawdbotConfig;
    const result = resolveThinkingDefault({
      cfg,
      provider: "anthropic",
      model: "claude-sonnet-4",
      catalog: reasoningCatalog,
    });
    expect(result).toBe("high");
  });

  it("returns 'off' for gemini-3-flash model", () => {
    const result = resolveThinkingDefault({
      cfg: emptyCfg,
      provider: "google",
      model: "gemini-3-flash",
      catalog: reasoningCatalog,
    });
    expect(result).toBe("off");
  });

  it("returns 'off' for gemini-pro model", () => {
    const result = resolveThinkingDefault({
      cfg: emptyCfg,
      provider: "google",
      model: "gemini-pro",
    });
    expect(result).toBe("off");
  });

  it("returns 'off' for any model with gemini in name", () => {
    const result = resolveThinkingDefault({
      cfg: emptyCfg,
      provider: "openrouter",
      model: "google/gemini-2.0-flash-001",
    });
    expect(result).toBe("off");
  });

  it("configured thinkingDefault overrides Gemini default", () => {
    const cfg = { agent: { thinkingDefault: "low" } } satisfies ClawdbotConfig;
    const result = resolveThinkingDefault({
      cfg,
      provider: "google",
      model: "gemini-3-flash",
      catalog: reasoningCatalog,
    });
    expect(result).toBe("low");
  });

  it("returns 'low' for non-Gemini models with reasoning capability", () => {
    const result = resolveThinkingDefault({
      cfg: emptyCfg,
      provider: "anthropic",
      model: "claude-sonnet-4",
      catalog: reasoningCatalog,
    });
    expect(result).toBe("low");
  });

  it("returns 'off' for models without reasoning capability", () => {
    const nonReasoningCatalog: ModelCatalogEntry[] = [
      { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
    ];
    const result = resolveThinkingDefault({
      cfg: emptyCfg,
      provider: "openai",
      model: "gpt-4o",
      catalog: nonReasoningCatalog,
    });
    expect(result).toBe("off");
  });
});
