import { useEffect, useRef } from "preact/hooks";
import { ChatStyles } from "./ChatStyles";

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
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onOpen?: () => void;
  onClose: () => void;
  onRetryMessage?: (message: LakecraftChatMessage) => void;
}

function formatChatTime(value: number | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function chatDateTime(value: number | string): string | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function ChatMessageRow({ message, onRetry }: { message: LakecraftChatMessage; onRetry?: (message: LakecraftChatMessage) => void }) {
  const tone = message.tone ?? "player";
  return (
    <li className={`lc-chat-message is-${tone}${message.own ? " is-own" : ""}${message.delivery ? ` is-${message.delivery}` : ""}`}>
      <div className="lc-chat-message-meta">
        <strong>{tone === "system" ? "WORLD" : message.username}</strong>
        <time dateTime={chatDateTime(message.sentAt)}>{formatChatTime(message.sentAt)}</time>
      </div>
      <p>{message.body}</p>
      {message.delivery === "sending" ? <small>Sending…</small> : null}
      {message.delivery === "failed" ? (
        onRetry ? <button type="button" onClick={() => onRetry(message)}>Not sent · retry</button> : <small>Not sent</small>
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
  onDraftChange,
  onSubmit,
  onOpen,
  onClose,
  onRetryMessage,
}: ChatOverlayProps) {
  const historyRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    const recent = messages.slice(-3);
    return (
      <aside className="lc-chat-peek" aria-label="Multiplayer chat">
        <ChatStyles />
        <ol aria-live="polite" aria-relevant="additions">
          {recent.map((message) => (
            <li key={message.id}><strong>{message.tone === "system" ? "WORLD" : message.username}</strong><span>{message.body}</span></li>
          ))}
        </ol>
        <button type="button" onClick={onOpen} aria-label={unreadCount ? `Open chat, ${unreadCount} unread messages` : "Open chat"}>
          <span aria-hidden="true">T</span>
          <span>Chat</span>
          {unreadCount > 0 ? <b>{unreadCount > 99 ? "99+" : unreadCount}</b> : null}
        </button>
      </aside>
    );
  }

  return (
    <section className="lc-chat-dialog" role="dialog" aria-label="Multiplayer chat" aria-modal="false">
      <ChatStyles />
      <header>
        <div>
          <span className={`lc-chat-signal${connected ? " is-connected" : ""}`} aria-hidden="true" />
          <strong>World chat</strong>
          <small>{connected ? "Live via Lakebed" : "Reconnecting…"}</small>
        </div>
        <button className="lc-chat-close" type="button" onClick={onClose} aria-label="Close chat"><span>Close</span><kbd>ESC</kbd></button>
      </header>

      <ul className="lc-chat-history" ref={historyRef} role="log" aria-live="polite" aria-relevant="additions text" aria-label="Chat messages">
        {messages.length ? messages.map((message) => <ChatMessageRow key={message.id} message={message} onRetry={onRetryMessage} />) : (
          <li className="lc-chat-empty"><span aria-hidden="true">⌁</span><strong>The trail is quiet.</strong><small>Say hello to the next explorer.</small></li>
        )}
      </ul>

      <form className="lc-chat-compose" onSubmit={submit}>
        <label htmlFor="lc-chat-input">Message everyone in this world</label>
        <div>
          <span aria-hidden="true">›</span>
          <input
            id="lc-chat-input"
            ref={inputRef}
            autoComplete="off"
            disabled={!connected}
            maxLength={maxLength}
            onInput={(event) => onDraftChange(event.currentTarget.value)}
            placeholder={connected ? placeholder : "Waiting for Lakebed…"}
            value={draft}
          />
          <small className={draft.length >= maxLength ? "is-limit" : ""}>{draft.length}/{maxLength}</small>
          <button disabled={!draft.trim() || sending || !connected} type="submit">{sending ? "Sending" : "Send"}<kbd>↵</kbd></button>
        </div>
        {error ? <p role="alert">{error}</p> : <small>Enter sends · Esc returns to the world</small>}
      </form>
    </section>
  );
}
