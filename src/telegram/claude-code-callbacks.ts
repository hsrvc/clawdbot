/**
 * Claude Code Telegram Callback Handlers
 *
 * Handles inline keyboard callbacks for Claude Code bubbles:
 * - claude:continue:<token> - Continue session (sends "continue" to DyDo/CC)
 * - claude:cancel:<token>   - Cancel a running session
 *
 * Note: No "answer" callback - DyDo intercepts and answers CC questions automatically.
 * User can give new instructions by replying to the bubble message directly.
 */

import type { Bot, Context } from "grammy";
import {
  sendInput,
  getSessionByToken,
  cancelSessionByToken,
  getSessionState,
  startSession,
  getBubbleByTokenPrefix,
  resumeSession,
  CLEAR_MARKUP,
  buildPlanningRequest,
} from "../agents/claude-code/index.js";
import { setForcedResumeToken } from "../agents/tools/claude-code-start-tool.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("telegram/claude-callbacks");

/**
 * Callback data format: "claude:<action>:<tokenPrefix>"
 */
type ClaudeCallbackData = {
  action: "continue" | "cancel";
  tokenPrefix: string;
};

/**
 * Parse callback data for Claude Code actions.
 * Note: "answer" action removed - DyDo handles CC questions automatically.
 */
function parseClaudeCallback(data: string): ClaudeCallbackData | null {
  const match = data.match(/^claude:(continue|cancel):(\w+)$/);
  if (!match) return null;
  return {
    action: match[1] as ClaudeCallbackData["action"],
    tokenPrefix: match[2],
  };
}

/**
 * Handle a Claude Code callback query.
 * Returns true if handled, false if not a Claude Code callback.
 */
export async function handleClaudeCodeCallback(
  ctx: Context,
  api: Bot["api"],
  data: string,
): Promise<boolean> {
  const parsed = parseClaudeCallback(data);
  if (!parsed) return false;

  const { action, tokenPrefix } = parsed;
  const callbackId = ctx.callbackQuery?.id;
  const chatId = ctx.callbackQuery?.message?.chat.id;
  const messageId = ctx.callbackQuery?.message?.message_id;

  log.info(`Handling claude callback: ${action} for ${tokenPrefix}`);

  // Find the session (may not exist if process exited)
  const session = getSessionByToken(tokenPrefix);

  switch (action) {
    case "cancel": {
      if (!session) {
        await api.answerCallbackQuery(callbackId ?? "", {
          text: "Session already ended",
        });
        return true;
      }
      const success = cancelSessionByToken(tokenPrefix);
      if (success) {
        await api.answerCallbackQuery(callbackId ?? "", {
          text: "Session cancelled",
        });
        // Update the message to show cancelled state and remove buttons
        if (chatId && messageId) {
          const state = getSessionState(session);
          await api
            .editMessageText(
              chatId,
              messageId,
              `**${state.projectName}**\n${state.runtimeStr} · Cancelled`,
              { parse_mode: "Markdown", reply_markup: CLEAR_MARKUP },
            )
            .catch(() => {});
        }
      } else {
        await api.answerCallbackQuery(callbackId ?? "", {
          text: "Failed to cancel session",
          show_alert: true,
        });
      }
      return true;
    }

    case "continue": {
      // If session is running in memory, send input
      if (session) {
        // Reset runtime limiter if paused
        resumeSession(session.id);

        const success = sendInput(session.id, "continue");
        if (success) {
          await api.answerCallbackQuery(callbackId ?? "", {
            text: "Sent continue signal",
          });
        } else {
          await api.answerCallbackQuery(callbackId ?? "", {
            text: "Session not accepting input",
            show_alert: true,
          });
        }
        return true;
      }

      // Session not in memory - try to spawn new process with --resume
      const bubbleInfo = getBubbleByTokenPrefix(tokenPrefix);
      if (bubbleInfo) {
        const { bubble } = bubbleInfo;
        const threadId = bubble.threadId;
        log.info(`Resuming session from bubble: ${bubble.resumeToken} in ${bubble.workingDir}`);

        // Acknowledge immediately
        await api.answerCallbackQuery(callbackId ?? "", {
          text: "Resuming session...",
        });

        // Import bubble service for live updates
        const { createSessionBubble, updateSessionBubble } =
          await import("../agents/claude-code/bubble-service.js");

        let newSessionId: string | undefined;

        // Start a new session with --resume and callbacks for live updates
        const result = await startSession({
          workingDir: bubble.workingDir,
          resumeToken: bubble.resumeToken,
          prompt: "continue",
          permissionMode: "bypassPermissions",
          onStateChange: async (state) => {
            if (!newSessionId) return;
            await updateSessionBubble({ sessionId: newSessionId, state });
          },
        });

        if (result.success) {
          newSessionId = result.sessionId;

          // Create live bubble for the resumed session
          if (chatId && result.sessionId && result.resumeToken) {
            const initialState = {
              status: "running" as const,
              projectName: bubble.projectName,
              resumeToken: result.resumeToken,
              runtimeStr: "0m",
              runtimeSeconds: 0,
              phaseStatus: "",
              branch: "",
              recentActions: [],
              hasQuestion: false,
              questionText: "",
              totalEvents: 0,
              isIdle: false,
            };

            await createSessionBubble({
              sessionId: result.sessionId,
              chatId: String(chatId),
              threadId,
              resumeToken: result.resumeToken,
              state: initialState,
              workingDir: bubble.workingDir,
              dydoCommand: "Continue work",
            });
          }
        } else {
          if (chatId) {
            await api
              .sendMessage(chatId, `Failed to resume: ${result.error}`, {
                parse_mode: "Markdown",
                ...(threadId && { message_thread_id: threadId }),
              })
              .catch(() => {});
          }
        }
        return true;
      }

      // No bubble info - can't resume
      await api.answerCallbackQuery(callbackId ?? "", {
        text: "Session info lost. Use CLI: claude --resume <token>",
        show_alert: true,
      });
      return true;
    }

    // Note: "answer" case removed - DyDo handles CC questions automatically
    // User can give new instructions by replying to the bubble message

    default:
      return false;
  }
}

/**
 * Check if callback data is for Claude Code.
 */
export function isClaudeCodeCallback(data: string): boolean {
  return data.startsWith("claude:");
}

/**
 * Result of handling a bubble reply.
 */
export type HandleBubbleReplyResult =
  | { type: "not_bubble_reply" }
  | { type: "handled_directly" } // e.g., sent input to running session
  | { type: "route_to_dydo"; orchestrationText: string }; // Let DyDo orchestrate

/**
 * Handle a reply to a Claude Code bubble message.
 *
 * When user replies to a bubble with text:
 * - If session is running: send the text as input directly (handled_directly)
 * - If session exited: route through DyDo for orchestration (route_to_dydo)
 *
 * DyDo will enrich the prompt with project context before starting Claude Code.
 */
export async function handleBubbleReply(params: {
  chatId: number | string;
  replyToMessageId: number;
  text: string;
  api: Bot["api"];
  /** Thread/topic ID - messages should stay in the same topic */
  threadId?: number;
  /** Original message text for fallback resume token extraction */
  originalMessageText?: string;
}): Promise<HandleBubbleReplyResult> {
  const { chatId, replyToMessageId, text, api, threadId, originalMessageText } = params;

  // Check if this is a reply to a bubble (in-memory lookup)
  const {
    isReplyToBubble,
    sendInput: sendSessionInput,
    getSession,
    logDyDoCommand,
    resolveProject,
  } = await import("../agents/claude-code/index.js");

  const bubbleInfo = isReplyToBubble(chatId, replyToMessageId);
  log.info(
    `[BUBBLE REPLY] isReplyToBubble returned: ${bubbleInfo ? `sessionId=${bubbleInfo.sessionId}, token=${bubbleInfo.bubble.resumeToken.slice(0, 8)}...` : "null"}`,
  );

  // If not found in memory, try to extract from message text
  if (!bubbleInfo) {
    // Try fallback: parse resume token from original message text
    log.info(
      `[BUBBLE REPLY] Fallback: parsing from message text (${originalMessageText?.length ?? 0} chars)`,
    );
    const fallbackInfo = parseResumeTokenFromMessage(originalMessageText);
    if (!fallbackInfo) {
      log.info(`[BUBBLE REPLY] Fallback parsing failed - not a bubble reply`);
      return { type: "not_bubble_reply" };
    }

    log.info(
      `[BUBBLE REPLY] Fallback parsed: token=${fallbackInfo.resumeToken}, project=${fallbackInfo.projectName}`,
    );

    // Log the new instruction
    logDyDoCommand({
      prompt: text,
      resumeToken: fallbackInfo.resumeToken,
      short: text.length > 50 ? `${text.slice(0, 47)}...` : text,
      project: fallbackInfo.projectName,
    });

    // Resolve project to get working directory (for worktree info)
    const resolved = await resolveProject(fallbackInfo.projectName);
    if (!resolved) {
      log.warn(`Could not resolve project: ${fallbackInfo.projectName}`);
      await api
        .sendMessage(chatId, `Could not find project: ${fallbackInfo.projectName}`, {
          parse_mode: "Markdown",
          ...(threadId && { message_thread_id: threadId }),
        })
        .catch(() => {});
      return { type: "handled_directly" }; // Error handled
    }

    // Route through DyDo for orchestration (enrich prompt with project context)
    // Set forced resume token to ensure code-level enforcement (keyed by chatId)
    setForcedResumeToken(fallbackInfo.resumeToken, String(chatId));

    const orchestrationText = buildPlanningRequest({
      action: "resume",
      project: fallbackInfo.projectName,
      task: text,
      resumeToken: fallbackInfo.resumeToken,
      chatContext: {
        chatId: String(chatId),
        threadId,
      },
    });

    return { type: "route_to_dydo", orchestrationText };
  }

  const { sessionId, bubble } = bubbleInfo;
  log.info(
    `[BUBBLE REPLY] Found in memory: sessionId=${sessionId}, token=${bubble.resumeToken.slice(0, 8)}..., project=${bubble.projectName}`,
  );
  log.info(`[BUBBLE REPLY] User message: ${text.slice(0, 50)}...`);

  // Log the new instruction as a DyDo command (for bubble display)
  logDyDoCommand({
    prompt: text,
    resumeToken: bubble.resumeToken,
    short: text.length > 50 ? `${text.slice(0, 47)}...` : text,
    project: bubble.projectName,
  });

  // Check if session is still running
  const session = getSession(sessionId);

  if (session) {
    // Session is running - send the text as input directly
    const success = sendSessionInput(sessionId, text);
    if (success) {
      log.info(`[${sessionId}] Sent bubble reply as input`);
      // Send confirmation (in the same thread/topic)
      await api
        .sendMessage(
          chatId,
          `📨 Sent to Claude Code: "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`,
          {
            parse_mode: "Markdown",
            ...(threadId && { message_thread_id: threadId }),
          },
        )
        .catch(() => {});
      return { type: "handled_directly" };
    }
    log.warn(`[${sessionId}] Failed to send input, will route to DyDo for resume`);
  }

  // Session not running - route through DyDo for orchestration
  // Set forced resume token to ensure code-level enforcement (keyed by chatId)
  setForcedResumeToken(bubble.resumeToken, String(chatId));

  const orchestrationText = buildPlanningRequest({
    action: "resume",
    project: bubble.projectName,
    task: text,
    resumeToken: bubble.resumeToken,
    chatContext: {
      chatId: String(chatId),
      threadId,
    },
  });

  return { type: "route_to_dydo", orchestrationText };
}

/**
 * Parse resume token and project name from bubble message text.
 * Looks for patterns like:
 * - `claude --resume <UUID>`
 * - `ctx: <projectName>`
 */
function parseResumeTokenFromMessage(
  messageText: string | undefined,
): { resumeToken: string; projectName: string } | null {
  if (!messageText) return null;

  // Extract resume token: `claude --resume <UUID>`
  const resumeMatch = messageText.match(/claude --resume ([a-f0-9-]{36})/);
  if (!resumeMatch) return null;

  const resumeToken = resumeMatch[1];

  // Extract project name: "ctx: <projectName>" or from header "**done** · <projectName> · "
  let projectName = "unknown";

  // Try "ctx: project @branch" format
  const ctxMatch = messageText.match(/ctx:\s*([^\n]+)/);
  if (ctxMatch) {
    projectName = ctxMatch[1].trim();
  } else {
    // Try header format "**working** · project · 5m"
    const headerMatch = messageText.match(/\*\*(?:working|done)\*\*\s*·\s*([^·]+)\s*·/);
    if (headerMatch) {
      projectName = headerMatch[1].trim();
    }
  }

  return { resumeToken, projectName };
}
