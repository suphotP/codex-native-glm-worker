import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = async (path) => await readFile(resolve(root, path), "utf8");

describe("native GLM integration static contracts", () => {
  test("pins GLM-5.3 max effort and one-million-token context", async () => {
    const role = await read("templates/glm_worker.toml");
    expect(role).toContain('model = "glm-5.3"');
    expect(role).toContain('model_reasoning_effort = "max"');
    expect(role).toContain("model_context_window = 1000000");
    expect(role).toContain("model_auto_compact_token_limit = 900000");
    expect(role).toContain("Never use codex exec");
    expect(role).toContain("memories = false");
  });

  test("uses the dedicated Z.AI Coding endpoint without a committed key", async () => {
    const config = await read("bridge/litellm.config.yaml");
    expect(config).toContain("https://api.z.ai/api/coding/paas/v4");
    expect(config).toContain("custom_openai/glm-5.3");
    expect(config).toContain("os.environ/ZAI_API_KEY");
    expect(config).toContain("reasoning_effort: max");
    expect(config).not.toMatch(/[A-Za-z0-9]{16,}\.[A-Za-z0-9]{16,}/);
  });

  test("keeps the Responses facade loopback-only and route-closed", async () => {
    const bridge = await read("bridge/responses-bridge.mjs");
    expect(bridge).toContain('hostname: "127.0.0.1"');
    expect(bridge).not.toContain('hostname: "0.0.0.0"');
    expect(bridge).toContain('url.pathname !== "/v1/responses"');
    expect(bridge).toContain("BRIDGE_AUTH_REQUIRED");
    expect(bridge).toContain("REQUEST_TOO_LARGE");
    expect(bridge).toContain("BRIDGE_CAPACITY_EXHAUSTED");
    expect(bridge).toContain("streamWithPermit");
    expect(bridge).toContain("streamOwnsPermit");
  });

  test("pins absolute runtime binaries into background services", async () => {
    const installer = await read("scripts/install-service.sh");
    const macos = await read("service/macos/com.codex.native-glm-worker.plist.template");
    const linux = await read("service/linux/codex-native-glm-worker.service.template");
    expect(installer).toContain("command -v bun");
    expect(installer).toContain("command -v litellm");
    expect(macos).toContain("NATIVE_GLM_BUN_BIN");
    expect(macos).toContain("NATIVE_GLM_LITELLM_BIN");
    expect(linux).toContain("NATIVE_GLM_BUN_BIN=__BUN_BIN__");
    expect(linux).toContain("NATIVE_GLM_LITELLM_BIN=__LITELLM_BIN__");
  });

  test("documents native spawn and refuses external pseudo-agent claims", async () => {
    const readme = await read("README.md");
    expect(readme).toContain('spawn_agent(agent_type="glm_worker")');
    expect(readme).toContain("not `codex exec`");
    expect(readme).toContain("visible in the Agents panel");
    expect(readme).toContain("fork_turns=\"none\"");
    expect(readme).toContain("OpenAI Responses endpoint");
    expect(readme).toContain("GLM is optional—not a replacement");
    expect(readme).toContain("does **not** change the root model");
    expect(readme).toContain("Mix OpenAI-backed and GLM-backed children");
    expect(readme).not.toContain("unlimited GLM");
  });

  test("contains no skill template TODOs", async () => {
    const skill = await read("skill/codex-native-glm-worker/SKILL.md");
    expect(skill).not.toContain("TODO");
    expect(skill).toContain("name: codex-native-glm-worker");
    expect(skill.split("\n").length).toBeLessThan(500);
  });

  test("does not commit provider-looking credentials", async () => {
    const paths = [
      "README.md",
      "bridge/litellm.config.yaml",
      "templates/codex-config.snippet.toml",
      "templates/glm_worker.toml",
      "service/linux/credentials.env.example",
    ];
    const combined = (await Promise.all(paths.map(read))).join("\n");
    expect(combined).not.toMatch(/[A-Za-z0-9]{24,}\.[A-Za-z0-9]{12,}/);
    expect(combined).not.toMatch(/ZAI_API_KEY\s*=\s*[A-Za-z0-9._-]{24,}/);
  });
});
