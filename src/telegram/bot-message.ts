// @ts-nocheck
import { buildTelegramMessageContext } from "./bot-message-context.js";
import { dispatchTelegramMessage } from "./bot-message-dispatch.js";
import { handleBubbleReply } from "./claude-code-callbacks.js";

export const createTelegramMessageProcessor = (deps) => {
  const {
    bot,
    cfg,
    account,
    telegramCfg,
    historyLimit,
    groupHistories,
    dmPolicy,
    allowFrom,
    groupAllowFrom,
    ackReactionScope,
    logger,
    resolveGroupActivation,
    resolveGroupRequireMention,
    resolveTelegramGroupConfig,
    runtime,
    replyToMode,
    streamMode,
    textLimit,
    opts,
    resolveBotTopicsEnabled,
  } = deps;

  return async (primaryCtx, allMedia, storeAllowFrom, options) => {
    // Check for Claude Code bubble replies first (before normal message processing)
    // This allows users to reply to bubble messages with new instructions
    const msg = primaryCtx.message ?? primaryCtx.editedMessage ?? primaryCtx.channelPost;
    if (msg?.reply_to_message?.message_id && msg.text) {
      const chatId = msg.chat?.id;
      if (chatId) {
        const result = await handleBubbleReply({
          chatId,
          replyToMessageId: msg.reply_to_message.message_id,
          text: msg.text,
          api: bot.api,
          // Pass thread ID so replies stay in the same topic
          threadId: msg.message_thread_id,
          // Pass original message text for fallback resume token extraction
          originalMessageText: msg.reply_to_message.text,
        });

        if (result.type === "handled_directly") {
          // Bubble reply was handled directly (e.g., sent to running session)
          return;
        }

        if (result.type === "route_to_dydo") {
          // Route through DyDo for orchestration
          // Replace the message text with the orchestration request
          msg.text = result.orchestrationText;
          // Continue to normal processing - DyDo will handle it
        }
        // If "not_bubble_reply", continue normal processing with original text
      }
    }

    const context = await buildTelegramMessageContext({
      primaryCtx,
      allMedia,
      storeAllowFrom,
      options,
      bot,
      cfg,
      account,
      historyLimit,
      groupHistories,
      dmPolicy,
      allowFrom,
      groupAllowFrom,
      ackReactionScope,
      logger,
      resolveGroupActivation,
      resolveGroupRequireMention,
      resolveTelegramGroupConfig,
    });
    if (!context) return;
    await dispatchTelegramMessage({
      context,
      bot,
      cfg,
      runtime,
      replyToMode,
      streamMode,
      textLimit,
      telegramCfg,
      opts,
      resolveBotTopicsEnabled,
    });
  };
};
