import type { ComponentChildren } from "preact";

export function menuButton(
  children: ComponentChildren,
  onClick?: () => void,
  disabled = false,
  style = 0,
  id?: string | number,
) {
  return (
    <button
      className={`lc-menu-button${style & 2 ? " is-wide" : ""}`}
      disabled={disabled}
      id={id}
      onClick={onClick}
      type={style & 1 ? "submit" : "button"}
    >{children}</button>
  );
}
