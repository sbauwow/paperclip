export const type = "prowler_local";
export const label = "Prowler Agent (local)";

export const models = [
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
];

export const agentConfigurationDoc = `# prowler_local agent configuration

Adapter: prowler_local

Runs tasks through prowler-agent locally via the Hermes CLI.
Uses hermes chat -q "<prompt>" -Q for non-interactive execution.

Core fields:
- cwd (string, optional): working directory for the agent process
- model (string, optional): model id (default: from ~/.hermes/config.yaml)
- command (string, optional): defaults to "hermes"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
- instructionsFilePath (string, optional): markdown instructions file path
- maxTurnsPerRun (number, optional): max turns per run
- yolo (boolean, optional): skip approval prompts

Operational fields:
- timeoutSec (number, optional): run timeout in seconds (default: 300)
- graceSec (number, optional): SIGTERM grace period in seconds (default: 15)
`;
