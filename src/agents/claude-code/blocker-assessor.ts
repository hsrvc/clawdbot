/**
 * Blocker Assessor - Level 2: DyDo's AI-Powered Blocker Judgment
 *
 * Instead of relying purely on pattern matching, this module asks DyDo
 * to read the context and make a semantic judgment about whether a
 * detected "blocker" is real or a false positive.
 */

import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { BlockerInfo, SessionEvent } from "./types.js";

const log = createSubsystemLogger("claude-code/blocker-assessor");

/**
 * Assessment result from DyDo
 */
export interface BlockerAssessment {
  /** Is this a real blocker? */
  isRealBlocker: boolean;
  /** Confidence level (0-1) */
  confidence: number;
  /** DyDo's reasoning */
  reasoning: string;
  /** Can DyDo handle this blocker automatically? (Level 3) */
  canAutoHandle?: boolean;
  /** Auto-response if canAutoHandle is true */
  autoResponse?: string;
}

/**
 * Ask DyDo to assess whether a blocker is real.
 *
 * This is the Level 2 implementation - passive judgment after session ends.
 *
 * @param blocker The detected blocker from pattern matching
 * @param sessionEvents Recent session events for context
 * @param sessionStatus Current session status
 * @returns Assessment from DyDo
 */
export async function assessBlocker(
  blocker: BlockerInfo,
  sessionEvents: SessionEvent[],
  sessionStatus: string,
): Promise<BlockerAssessment> {
  // Build context for DyDo
  const contextSummary = buildContextSummary(blocker, sessionEvents, sessionStatus);

  log.info(`[Level 2] Asking DyDo to assess blocker: ${blocker.reason}`);

  try {
    // Call DyDo's assessment logic
    const assessment = await invokeDyDoAssessment(contextSummary);

    log.info(
      `[Level 2] DyDo assessment: ${assessment.isRealBlocker ? "REAL" : "FALSE POSITIVE"} (confidence: ${assessment.confidence})`,
    );

    return assessment;
  } catch (err) {
    log.error(`[Level 2] DyDo assessment failed: ${err}`);

    // Fallback: conservative - assume it's real if pattern matching detected it
    return {
      isRealBlocker: true,
      confidence: 0.5,
      reasoning: "Assessment failed, defaulting to pattern matching result",
    };
  }
}

/**
 * Build a context summary for DyDo to analyze.
 */
function buildContextSummary(
  blocker: BlockerInfo,
  sessionEvents: SessionEvent[],
  sessionStatus: string,
): string {
  const recentMessages = sessionEvents
    .filter((e) => e.type === "assistant_message" && e.text)
    .slice(-10)
    .map((e, i) => `[${i + 1}] ${e.text?.slice(0, 500)}...`)
    .join("\n\n");

  const extractedCtx = blocker.extractedContext
    ? `\nExtracted Context:\n${JSON.stringify(blocker.extractedContext, null, 2)}`
    : "";

  return `
## Blocker Detection Context

**Detected Reason:** ${blocker.reason}
**Matched Patterns:** ${blocker.matchedPatterns.join(", ")}
**Session Status:** ${sessionStatus}${extractedCtx}

**Recent Messages (last 10):**
${recentMessages}

## Your Task

You are DyDo, reviewing a Claude Code session that pattern matching flagged as "possibly blocked".

**Analyze the context above and determine:**

1. **Is this a REAL blocker?**
   - Real blocker: Claude Code needs user/external intervention to continue
   - False positive: Pattern matching triggered on list items, examples, or completed tasks

2. **Confidence level (0.0 to 1.0)**
   - 0.9-1.0: Very confident in your judgment
   - 0.7-0.8: Confident but some uncertainty
   - 0.5-0.6: Uncertain, could go either way
   - 0.0-0.4: Low confidence

3. **Reasoning:** Why did you reach this conclusion?

4. **(Level 3) Can you handle this automatically?**
   - If yes, provide the response you'd send to Claude Code

**Respond in JSON format:**
\`\`\`json
{
  "isRealBlocker": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Your analysis here",
  "canAutoHandle": true/false,
  "autoResponse": "Your response to Claude Code (if canAutoHandle is true)"
}
\`\`\`
`.trim();
}

/**
 * Invoke DyDo's assessment logic.
 *
 * This is a placeholder that should be replaced with actual agent invocation.
 * For now, it uses a simple heuristic-based assessment.
 */
async function invokeDyDoAssessment(contextSummary: string): Promise<BlockerAssessment> {
  // TODO: Replace this with actual DyDo agent invocation
  // For now, use heuristic-based assessment

  log.debug("[Level 2] Using heuristic assessment (TODO: integrate real DyDo)");

  // Heuristic 1: If the context contains completion signals, it's likely a false positive
  const hasCompletionSignal = /✅.*ready|all.*complete|finished|done!/i.test(contextSummary);

  if (hasCompletionSignal) {
    return {
      isRealBlocker: false,
      confidence: 0.9,
      reasoning: "Detected completion signal (✅ ready / all complete). This is a false positive.",
    };
  }

  // Heuristic 2: If it's in a list context (Tasks where..., Criteria:, etc.)
  const isListContext = /Tasks? where|Criteria|Signals?|Examples?|Quantitative|Qualitative/i.test(
    contextSummary,
  );

  if (isListContext) {
    return {
      isRealBlocker: false,
      confidence: 0.85,
      reasoning:
        "Detected list/criteria context. The pattern match is likely from documentation or analysis, not a real blocker.",
    };
  }

  // Heuristic 3: Funding-related patterns are usually real
  const isFunding = /need(s|ed)?\s+(\d+(?:\.\d+)?)\s*sol|insufficient.*balance/i.test(
    contextSummary,
  );

  if (isFunding) {
    return {
      isRealBlocker: true,
      confidence: 0.9,
      reasoning: "Detected funding/balance issue. This is a real blocker.",
    };
  }

  // Default: uncertain, lean towards real blocker (conservative)
  return {
    isRealBlocker: true,
    confidence: 0.6,
    reasoning:
      "Unable to determine with high confidence. Defaulting to real blocker (conservative).",
  };
}
