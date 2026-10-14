import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.BIZINTEL_DATA_DIR = mkdtempSync(join(tmpdir(), "bizintel-test-"));
process.env.LLM_BASE_URL = "https://llm.test/v1";
process.env.LLM_API_KEY = "test";
process.env.LLM_MODEL = "test-model";
const { llmJson } = await import("../src/server/providers/llm");

const reply = (content: string, finish_reason: string) => Response.json({ choices: [{ message: { content }, finish_reason }] });

function mockLlm(replies: Response[]) {
  const caps: number[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    caps.push(JSON.parse(init.body).max_tokens);
    return replies.shift()!;
  });
  return caps;
}

afterEach(() => vi.unstubAllGlobals());

describe("llmJson cut-off replies", () => {
  it("retries once with a larger token cap when a reply is cut off", async () => {
    const caps = mockLlm([reply('{"sections": {"a": "trunc', "length"), reply('{"ok": true}', "stop")]);
    expect(await llmJson<{ ok: boolean }>("s", "u", { maxTokens: 5000 })).toEqual({ ok: true });
    expect(caps).toEqual([5000, 12500]);
  });

  it("gives up after the one larger retry", async () => {
    const caps = mockLlm([reply('{"a": "x', "length"), reply('{"a": "y', "length")]);
    await expect(llmJson("s", "u", { maxTokens: 5000 })).rejects.toThrow(/cut off/);
    expect(caps).toEqual([5000, 12500]);
  });
});
