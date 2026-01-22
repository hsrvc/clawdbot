/**
 * Planning Request Builder for Claude Code
 *
 * Builds the message that gets injected into DyDo's conversation
 * when user runs /claude command. DyDo then:
 * 1. Loads project context
 * 2. Analyzes the task
 * 3. Asks clarifying questions if needed
 * 4. Spawns Claude Code with enriched prompt
 */

export interface PlanningRequestParams {
  /** Action type */
  action: "start" | "resume";
  /** Project name or identifier */
  project: string;
  /** User's task description */
  task?: string;
  /** Resume token (for resume action) */
  resumeToken?: string;
  /** Worktree/branch if specified */
  worktree?: string;
  /** Skip planning (--quick mode) */
  quick?: boolean;
  /** Chat context for bubble updates */
  chatContext?: {
    chatId: string;
    threadId?: number;
    accountId?: string;
    /** Force this resume token (code-level enforcement, overrides DyDo's value) */
    forcedResumeToken?: string;
  };
}

/**
 * Build a planning request message for DyDo
 */
export function buildPlanningRequest(params: PlanningRequestParams): string {
  const { action, project, task, resumeToken, worktree, quick } = params;

  if (quick) {
    // Quick mode - minimal planning, just start
    return buildQuickStartRequest(params);
  }

  if (action === "resume") {
    return buildResumeRequest(params);
  }

  return buildFullPlanningRequest(params);
}

/**
 * Build quick-start request (minimal planning)
 */
function buildQuickStartRequest(params: PlanningRequestParams): string {
  const { project, task, worktree } = params;
  const projectSpec = worktree ? `${project} @${worktree}` : project;

  const lines = [
    `[Claude Code Quick Start]`,
    ``,
    `Project: ${projectSpec}`,
    `Task: ${task || "Continue working"}`,
    ``,
    `Start a Claude Code session immediately with this task.`,
    `Use the claude_code_start tool with the task as the prompt.`,
  ];

  return lines.join("\n");
}

/**
 * Build resume request with full orchestration (DyDo enriches the prompt)
 */
function buildResumeRequest(params: PlanningRequestParams): string {
  const { project, task, resumeToken, chatContext } = params;

  const lines = [
    `[Claude Code Resume Request]`,
    ``,
    `**CRITICAL RULES:**`,
    `1. You MUST call \`claude_code_start\` tool immediately`,
    `2. You MUST use EXACTLY this resumeToken: "${resumeToken}"`,
    `3. Do NOT respond with text messages`,
    ``,
    `Project: ${project || "(from token)"}`,
    `User said: "${task || "continue"}"`,
    ``,
    `## Required Tool Call`,
    `Call \`claude_code_start\` with these EXACT values:`,
  ];

  // Build the tool call structure with emphasized token
  lines.push(`- project: "${project}"`);
  lines.push(`- resumeToken: "${resumeToken}" ← MUST USE THIS EXACT TOKEN`);
  lines.push(`- prompt: <add project context to user's request>`);
  if (chatContext) {
    lines.push(`- chatId: "${chatContext.chatId}"`);
    if (chatContext.threadId) lines.push(`- threadId: ${chatContext.threadId}`);
  }

  lines.push(
    ``,
    `**WARNING:** If you omit resumeToken or use a different value, it will start a NEW session instead of resuming. The user wants to CONTINUE their existing session.`,
  );

  return lines.join("\n");
}

/**
 * Build full planning request - DyDo acts as orchestrator
 */
function buildFullPlanningRequest(params: PlanningRequestParams): string {
  const { project, task, worktree, chatContext } = params;
  const projectSpec = worktree ? `${project} @${worktree}` : project;

  // If no task specified, ask what to do
  if (!task) {
    return [
      `[Claude Code Request]`,
      `Project: ${projectSpec}`,
      ``,
      `User wants to start a Claude Code session but didn't specify a task.`,
      `Ask them what they want to work on.`,
    ].join("\n");
  }

  // Task specified - DyDo should call the tool
  const lines = [
    `[Claude Code Start Request]`,
    ``,
    `**CRITICAL: You MUST call the \`claude_code_start\` tool. Do NOT respond with text messages.**`,
    ``,
    `Project: ${projectSpec}`,
    `User said: "${task}"`,
    ``,
    `## Your Task`,
    `1. BRIEFLY check project context (use \`project_context\` tool)`,
    `2. Call \`claude_code_start\` with enriched instructions`,
    ``,
    `## Tool Call (REQUIRED)`,
  ];

  // Build the tool call structure
  lines.push(`\`\`\``);
  lines.push(`claude_code_start({`);
  lines.push(`  project: "${project}",`);
  if (worktree) lines.push(`  worktree: "${worktree}",`);
  lines.push(`  prompt: "<ENRICHED INSTRUCTIONS - add project context>",`);
  lines.push(`  originalTask: "${task.replace(/"/g, '\\"')}",`);
  if (chatContext) {
    lines.push(`  chatId: "${chatContext.chatId}",`);
    if (chatContext.threadId) lines.push(`  threadId: ${chatContext.threadId},`);
    if (chatContext.accountId) lines.push(`  accountId: "${chatContext.accountId}",`);
  }
  lines.push(`})`);
  lines.push(`\`\`\``);

  lines.push(
    ``,
    `**Rules:**`,
    `- DO NOT respond with text messages - call the tool`,
    `- Add context from project (phase, blockers, etc.) to the prompt`,
    `- Only ask clarifying question if TRULY ambiguous (rarely needed)`,
  );

  return lines.join("\n");
}

/**
 * Check if a message looks like it's responding to a Claude Code question
 * (Used to detect when DyDo should forward response to Claude Code)
 */
export function isClaudeCodeResponse(message: string): boolean {
  const lowerMsg = message.toLowerCase();

  // Check for explicit directives
  if (lowerMsg.includes("[to claude code]")) return true;
  if (lowerMsg.includes("tell claude code")) return true;
  if (lowerMsg.includes("claude code:")) return true;

  return false;
}

/**
 * Extract the response content from a Claude Code response message
 */
export function extractClaudeCodeResponse(message: string): string {
  // Remove directive markers
  let response = message
    .replace(/\[to claude code\]/gi, "")
    .replace(/tell claude code:?/gi, "")
    .replace(/claude code:/gi, "")
    .trim();

  return response;
}
