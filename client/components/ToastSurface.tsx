export type HudMessage = {
  id: string;
  text: string;
  detail?: string;
  tone?: "info" | "success" | "warning";
};

export type ToastSurfaceProps = { messages: readonly HudMessage[]; onDismiss?: (id: string) => void };

export function ToastSurface({ messages, onDismiss }: ToastSurfaceProps) {
  return (
    <div className="lc-toasts" role="status" aria-live="polite" aria-atomic="false">
      {messages.slice(-3).map((message) => (
        <button className={`lc-toast lc-toast--${message.tone ?? "info"}`} key={message.id} onClick={() => onDismiss?.(message.id)} type="button">
          <span className="lc-toast__pin" aria-hidden="true" />
          <span><strong>{message.text}</strong>{message.detail ? <small>{message.detail}</small> : null}</span>
        </button>
      ))}
    </div>
  );
}
