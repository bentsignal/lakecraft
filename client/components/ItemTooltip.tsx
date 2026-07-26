import { useEffect, useRef } from "preact/hooks";
import {
  itemTooltipAnchorVisible,
  positionItemTooltip,
  reconcileItemTooltipSources,
  type ItemTooltipSources,
} from "./itemTooltipModel";

const TOOLTIP_ID = "lc-item-tooltip";
const TOOLTIP_SELECTOR = "[data-tip]";
const CURSOR_SELECTOR = ".lc-cursor-stack";

function tooltipTarget(value: EventTarget | null): HTMLElement | null {
  if (!(value instanceof Element)) return null;
  const target = value.closest(TOOLTIP_SELECTOR);
  return target instanceof HTMLElement ? target : null;
}

export function ItemTooltip() {
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const surface = tooltipRef.current!;
    const sources: ItemTooltipSources<HTMLElement> = { pointer: null, focus: null };
    let description: [HTMLElement, string | null] | null = null;
    let cursorActive = Boolean(document.querySelector(CURSOR_SELECTOR));

    const describe = (target: HTMLElement | null) => {
      if (description?.[0] === target) return;
      if (description) {
        const [previousTarget, previousValue] = description;
        if (previousValue === null) previousTarget.removeAttribute("aria-describedby");
        else previousTarget.setAttribute("aria-describedby", previousValue);
      }
      description = null;
      if (target) {
        const previousValue = target.getAttribute("aria-describedby");
        description = [target, previousValue];
        if (!previousValue?.split(/\s+/).includes(TOOLTIP_ID)) {
          target.setAttribute("aria-describedby", `${previousValue ? `${previousValue} ` : ""}${TOOLTIP_ID}`);
        }
      }
    };
    const hide = () => {
      describe(null);
      surface.style.visibility = "hidden";
    };
    const position = (target: HTMLElement) => {
      const anchor = target.getBoundingClientRect();
      const viewport = { width: innerWidth, height: innerHeight };
      if (!itemTooltipAnchorVisible(anchor, viewport)) {
        surface.style.visibility = "hidden";
        return;
      }
      const point = positionItemTooltip(anchor, surface.getBoundingClientRect(), viewport);
      if (!point) {
        surface.style.visibility = "hidden";
        return;
      }
      surface.style.left = `${Math.round(point.x)}px`;
      surface.style.top = `${Math.round(point.y)}px`;
      surface.style.visibility = "visible";
    };
    const activate = (forcePosition = false) => {
      const target = cursorActive ? null : sources.pointer ?? sources.focus;
      const content = target?.isConnected ? target.dataset.tip?.trim() : null;
      if (!target || !content) return hide();
      if (!forcePosition && description?.[0] === target && surface.textContent === content) return;
      describe(target);
      if (surface.textContent !== content) surface.textContent = content;
      position(target);
    };
    const updateSource = (source: keyof typeof sources, target: HTMLElement | null) => {
      if (sources[source] === target) return;
      sources[source] = target;
      if (!cursorActive) activate();
    };
    const onEvent = (event: Event) => {
      const target = tooltipTarget(event.target);
      if (event.type === "pointerover") {
        updateSource("pointer", target);
      } else if (event.type === "pointerout") {
        if (sources.pointer !== target || tooltipTarget((event as PointerEvent).relatedTarget) === target) return;
        updateSource("pointer", tooltipTarget((event as PointerEvent).relatedTarget));
      } else if (event.type === "focusin") {
        updateSource("focus", target);
      } else if (sources.focus === target && tooltipTarget((event as FocusEvent).relatedTarget) !== target) {
        updateSource("focus", tooltipTarget((event as FocusEvent).relatedTarget));
      }
    };
    const onViewportChange = () => {
      if (sources.pointer && !sources.pointer.matches(":hover")) sources.pointer = null;
      activate(true);
    };
    const resumableTarget = (value: EventTarget | null) => {
      const target = tooltipTarget(value);
      if (!target) return null;
      return itemTooltipAnchorVisible(target.getBoundingClientRect(), { width: innerWidth, height: innerHeight })
        ? target
        : null;
    };
    const observer = new MutationObserver((records) => {
      if (records.every((record) => surface.contains(record.target))) return;
      const nextCursorActive = Boolean(document.querySelector(CURSOR_SELECTOR));
      reconcileItemTooltipSources(
        sources,
        cursorActive && !nextCursorActive,
        nextCursorActive,
        resumableTarget(document.querySelector(`${TOOLTIP_SELECTOR}:hover`)),
        resumableTarget(document.activeElement),
        (target) => target.isConnected,
        (target) => Boolean(target.dataset.tip?.trim()),
      );
      cursorActive = nextCursorActive;
      activate();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-tip"],
      childList: true,
      subtree: true,
    });
    const eventNames = ["pointerover", "pointerout", "focusin", "focusout"];
    for (const name of eventNames) document.addEventListener(name, onEvent, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      observer.disconnect();
      describe(null);
      for (const name of eventNames) document.removeEventListener(name, onEvent, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, []);

  return <div className="lc-item-tooltip" id={TOOLTIP_ID} ref={tooltipRef} role="tooltip" />;
}
