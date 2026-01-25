/**
 * Realtime Interventor - Level 3: Proactive Blocker Prevention
 *
 * Monitors Claude Code sessions in real-time and intervenes immediately
 * when a potential blocker is detected, allowing DyDo to answer questions
 * automatically without user involvement.
 */

import { createSubsystemLogger } from "../../logging/subsystem.js";
import { detectBlocker } from "./blocker-detector.js";
import type { BlockerInfo, SessionEvent } from "./types.js";

const log = createSubsystemLogger("claude-code/realtime-interventor");

/**
 * Intervention result
 */
export interface InterventionResult {
  /** Did we intervene? */
  intervened: boolean;
  /** Response sent to Claude Code (if intervened) */
  response?: string;
  /** Why we intervened (or didn't) */
  reasoning: string;
}

/**
 * Monitor assistant messages in real-time and intervene if needed.
 *
 * This is the Level 3 implementation - active monitoring during session execution.
 *
 * @param event The assistant message event
 * @param sessionContext Any context about the current session
 * @returns Intervention result (with optional response to send)
 */
export async function checkForRealtimeIntervention(
  event: SessionEvent,
  sessionContext: {
    sessionId: string;
    projectName: string;
    recentEvents: SessionEvent[];
  },
): Promise<InterventionResult> {
  if (event.type !== "assistant_message" || !event.text) {
    return { intervened: false, reasoning: "Not an assistant message" };
  }

  // Run blocker detection (without sessionEnded flag, so requires stronger signal)
  const suspectedBlocker = detectBlocker(event.text, false);

  if (!suspectedBlocker) {
    return { intervened: false, reasoning: "No blocker pattern detected" };
  }

  log.info(`[${sessionContext.sessionId}] Realtime blocker suspected: ${suspectedBlocker.reason}`);

  // Ask DyDo: Can you handle this?
  const intervention = await askDyDoForIntervention(suspectedBlocker, event.text, sessionContext);

  if (intervention.canHandle && intervention.response) {
    log.info(`[${sessionContext.sessionId}] DyDo will intervene with response`);
    return {
      intervened: true,
      response: intervention.response,
      reasoning: intervention.reasoning,
    };
  }

  log.info(
    `[${sessionContext.sessionId}] DyDo cannot handle this blocker - will notify user later`,
  );
  return {
    intervened: false,
    reasoning: intervention.reasoning,
  };
}

/**
 * DyDo's intervention response
 */
interface InterventionDecision {
  /** Can DyDo handle this automatically? */
  canHandle: boolean;
  /** Response to send to Claude Code */
  response?: string;
  /** Reasoning */
  reasoning: string;
}

/**
 * Ask DyDo whether it can handle this blocker automatically.
 */
async function askDyDoForIntervention(
  blocker: BlockerInfo,
  questionText: string,
  sessionContext: {
    sessionId: string;
    projectName: string;
    recentEvents: SessionEvent[];
  },
): Promise<InterventionDecision> {
  // Build context for DyDo
  const contextSummary = buildInterventionContext(blocker, questionText, sessionContext);

  log.info(`[${sessionContext.sessionId}] Asking DyDo for intervention decision`);

  try {
    // Invoke DyDo's intervention logic
    const decision = await invokeDyDoIntervention(contextSummary);

    log.info(
      `[${sessionContext.sessionId}] DyDo decision: ${decision.canHandle ? "CAN HANDLE" : "CANNOT HANDLE"}`,
    );

    return decision;
  } catch (err) {
    log.error(`[${sessionContext.sessionId}] DyDo intervention failed: ${err}`);

    // Fallback: don't intervene
    return {
      canHandle: false,
      reasoning: "Intervention assessment failed, escalating to user",
    };
  }
}

/**
 * Build context for DyDo's intervention decision.
 */
function buildInterventionContext(
  blocker: BlockerInfo,
  questionText: string,
  sessionContext: {
    sessionId: string;
    projectName: string;
    recentEvents: SessionEvent[];
  },
): string {
  const recentMessages = sessionContext.recentEvents
    .filter((e) => e.type === "assistant_message" && e.text)
    .slice(-5)
    .map((e, i) => `[${i + 1}] ${e.text?.slice(0, 300)}...`)
    .join("\n\n");

  return `
## Real-Time Intervention Request

**Project:** ${sessionContext.projectName}
**Session ID:** ${sessionContext.sessionId}

**Claude Code just said:**
"${questionText}"

**Detected blocker pattern:** ${blocker.reason}

**Recent conversation (last 5 messages):**
${recentMessages}

## Your Task

You are DyDo, monitoring a Claude Code session in real-time. Claude Code appears to be waiting for something.

**Can you handle this automatically?**

Examples you CAN handle:
- "Should I proceed with this change?" → "Yes, proceed"
- "Which approach do you prefer?" → Make a decision based on project context
- "Do you want me to continue?" → "Yes, continue"

Examples you CANNOT handle:
- "You need to fund this wallet: 0x..." → User must do this
- "The build failed, manual fix needed" → User must debug
- "Rate limited, wait 5 minutes" → Must wait

**Respond in JSON:**
\`\`\`json
{
  "canHandle": true/false,
  "response": "Your response to Claude Code (if canHandle is true)",
  "reasoning": "Why you can/cannot handle this"
}
\`\`\`
`.trim();
}

/**
 * Invoke DyDo's intervention decision.
 *
 * This is a placeholder that should be replaced with actual agent invocation.
 * For now, it uses simple heuristics.
 */
async function invokeDyDoIntervention(contextSummary: string): Promise<InterventionDecision> {
  // TODO: Replace with actual DyDo agent invocation

  log.debug("[Level 3] Using heuristic intervention (TODO: integrate real DyDo)");

  // Heuristic 1: Simple yes/no questions
  const isYesNoQuestion = /should i proceed|do you want|shall i continue/i.test(contextSummary);

  if (isYesNoQuestion) {
    return {
      canHandle: true,
      response: "Yes, please proceed.",
      reasoning: "Simple yes/no question - DyDo can approve",
    };
  }

  // Heuristic 2: Funding/wallet issues - cannot handle
  const isFundingIssue = /fund|wallet|balance|sol/i.test(contextSummary);

  if (isFundingIssue) {
    return {
      canHandle: false,
      reasoning: "Funding issue requires user action",
    };
  }

  // Default: don't intervene (conservative)
  return {
    canHandle: false,
    reasoning: "Uncertain - escalating to user for safety",
  };
}
