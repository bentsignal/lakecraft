import { useEffect, useRef, useState } from "preact/hooks";
import { ChatStyles } from "./ChatStyles";
import { CHAT_PEEK_MAX_AGE_MS, chatPeekMessageFading, nextChatPeekExpiryDelay, visibleChatPeekMessages } from "./chatPeek.ts";

export type ChatMessageTone = "player" | "system" | "warning";
export type ChatDeliveryState = "sending" | "sent" | "failed";

export interface LakecraftChatMessage {
  id: string;
  username: string;
  body: string;
  sentAt: number | string;
  own?: boolean;
  tone?: ChatMessageTone;
  delivery?: ChatDeliveryState;
}

export interface ChatOverlayProps {
  messages: readonly LakecraftChatMessage[];
  open: boolean;
  draft: string;
  unreadCount?: number;
  sending?: boolean;
  connected?: boolean;
  error?: string;
  maxLength?: number;
  placeholder?: string;
  surfaceLabel?: string;
  historyLabel?: string;
  inputLabel?: string;
  playerSender?: string;
  systemSender?: string;
  warningSender?: string;
  peekMaxAgeMs?: number;
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onOpen?: () => void;
  onClose: () => void;
  onRetryMessage?: (message: LakecraftChatMessage) => void;
}

interface ChatSenderLabels {
  player?: string;
  system: string;
  warning: string;
}

function senderForMessage(message: LakecraftChatMessage, labels: ChatSenderLabels): string {
  const tone = message.tone ?? "player";
  return tone === "player" ? labels.player ?? `<${message.username}>` : tone === "warning" ? labels.warning : labels.system;
}

function ChatMessageRow({
  message,
  onRetry,
  senderLabels,
}: {
  message: LakecraftChatMessage;
  onRetry?: (message: LakecraftChatMessage) => void;
  senderLabels: ChatSenderLabels;
}) {
  const tone = message.tone ?? "player";
  const sender = senderForMessage(message, senderLabels);
  return (
    <li className={`lc-chat-message is-${tone}${message.own ? " is-own" : ""}${message.delivery ? ` is-${message.delivery}` : ""}`}>
      <p><strong>{sender}</strong> <span>{message.body}</span></p>
      {message.delivery === "sending" ? <small>Sending…</small> : null}
      {message.delivery === "failed" ? (
        onRetry ? <button type="button" onClick={() => onRetry(message)}>Not sent — click to retry</button> : <small>Not sent</small>
      ) : null}
    </li>
  );
}

export function ChatOverlay({
  messages,
  open,
  draft,
  unreadCount = 0,
  sending = false,
  connected = true,
  error,
  maxLength = 240,
  placeholder = "Message everyone…",
  surfaceLabel = "Multiplayer chat",
  historyLabel = "Chat messages",
  inputLabel = "Chat message",
  playerSender,
  systemSender = "[Server]",
  warningSender = "[Warning]",
  peekMaxAgeMs = CHAT_PEEK_MAX_AGE_MS,
  onDraftChange,
  onSubmit,
  onClose,
  onRetryMessage,
}: ChatOverlayProps) {
  const historyRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [peekNow, setPeekNow] = useState(Date.now());
  const senderLabels = { player: playerSender, system: systemSender, warning: warningSender };

  useEffect(() => {
    if (open || !Number.isFinite(peekMaxAgeMs)) return;
    let timer = 0;
    const refresh = () => {
      const now = Date.now();
      setPeekNow(now);
      const delay = nextChatPeekExpiryDelay(messages, now, peekMaxAgeMs);
      if (delay !== null) timer = window.setTimeout(refresh, delay);
    };
    refresh();
    return () => window.clearTimeout(timer);
  }, [open, peekMaxAgeMs, messages.length, messages[messages.length - 1]?.id]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [open]);

  useEffect(() => {
    const history = historyRef.current;
    if (history && open) history.scrollTop = history.scrollHeight;
  }, [messages.length, open]);

  function submit(event: Event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending || !connected) return;
    onSubmit(body);
  }

  if (!open) {
    const recent = visibleChatPeekMessages(messages, peekNow, peekMaxAgeMs);
    return (
      <aside className="lc-chat-peek" aria-label={surfaceLabel}>
        <ChatStyles />
        <ol aria-live="polite" aria-relevant="additions">
          {recent.map((message) => (
            <li className={`is-${message.tone ?? "player"}${chatPeekMessageFading(message, peekNow, peekMaxAgeMs) ? " is-fading" : ""}`} key={message.id}>
              <strong>{senderForMessage(message, senderLabels)}</strong>
              <span>{message.body}</span>
            </li>
          ))}
        </ol>
        {unreadCount > 0 ? <span className="lc-chat-unread">+{unreadCount > 99 ? "99" : unreadCount}</span> : null}
      </aside>
    );
  }

  return (
    <section
      className="lc-chat-dialog"
      role="dialog"
      aria-label={surfaceLabel}
      aria-modal="false"
      onKeyDown={(event) => {
        if (event.code !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <ChatStyles />
      <ul className="lc-chat-history" ref={historyRef} role="log" aria-live="polite" aria-relevant="additions text" aria-label={historyLabel}>
        {messages.map((message) => (
          <ChatMessageRow key={message.id} message={message} onRetry={onRetryMessage} senderLabels={senderLabels} />
        ))}
      </ul>

      <form className="lc-chat-compose" onSubmit={submit}>
        <label htmlFor="lc-chat-input">{inputLabel}</label>
        <div>
          <input
            id="lc-chat-input"
            ref={inputRef}
            autoComplete="off"
            disabled={!connected}
            maxLength={maxLength}
            onInput={(event) => onDraftChange(event.currentTarget.value)}
            placeholder={connected ? placeholder : "Connecting…"}
            value={draft}
          />
          <small className={draft.length >= maxLength ? "is-limit" : ""}>{draft.length > maxLength - 24 ? `${draft.length}/${maxLength}` : ""}</small>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
