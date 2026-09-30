import "server-only";

/** Whether the AI assistant can answer: an Anthropic credential is set and it isn't switched off. */
export function aiEnabled(): boolean {
  if (process.env.FEEDBACK_AI_ENABLED === "false") return false;
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}
