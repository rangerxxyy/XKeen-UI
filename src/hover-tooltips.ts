export interface TooltipTarget {
  dataset: { tooltip?: string };
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
}

export function extractTooltipText(target: TooltipTarget): string {
  const text = (target.dataset.tooltip || target.getAttribute('title') || '').trim();
  if (!text) return '';
  target.dataset.tooltip = text;
  if (target.hasAttribute('title')) target.removeAttribute('title');
  return text;
}

export function bindHoverTooltips(doc: Document): void {
  if (doc.body.dataset.appTooltipsBound === 'true') return;
  doc.body.dataset.appTooltipsBound = 'true';

  const tooltip = doc.createElement('div');
  tooltip.className = 'app-hover-tooltip';
  tooltip.id = 'app-hover-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  doc.body.append(tooltip);

  let activeTarget: HTMLElement | null = null;
  let previousDescription: string | null = null;

  const hide = () => {
    if (activeTarget) {
      if (previousDescription === null) activeTarget.removeAttribute('aria-describedby');
      else activeTarget.setAttribute('aria-describedby', previousDescription);
    }
    activeTarget = null;
    previousDescription = null;
    tooltip.classList.remove('is-visible');
    tooltip.hidden = true;
  };

  const show = (target: HTMLElement | null) => {
    if (!target || target.matches('.dns-info') || target === activeTarget) return;
    const text = extractTooltipText(target);
    if (!text) return;
    hide();

    activeTarget = target;
    previousDescription = target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby', previousDescription ? `${previousDescription} ${tooltip.id}` : tooltip.id);
    tooltip.textContent = text;
    tooltip.hidden = false;

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - tooltipRect.width - 8, targetRect.left + (targetRect.width - tooltipRect.width) / 2));
    const above = targetRect.top - tooltipRect.height - 8;
    const top = above >= 8 ? above : Math.min(window.innerHeight - tooltipRect.height - 8, targetRect.bottom + 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
    requestAnimationFrame(() => tooltip.classList.add('is-visible'));
  };

  const findTarget = (eventTarget: EventTarget | null): HTMLElement | null =>
    eventTarget instanceof Element ? eventTarget.closest<HTMLElement>('[title], [data-tooltip]') : null;

  doc.addEventListener('pointerover', (event) => show(findTarget(event.target)));
  doc.addEventListener('focusin', (event) => show(findTarget(event.target)));
  doc.addEventListener('pointerout', (event) => {
    if (activeTarget && activeTarget.contains(event.target as Node) && !activeTarget.contains(event.relatedTarget as Node | null)) hide();
  });
  doc.addEventListener('focusout', (event) => {
    if (activeTarget && activeTarget.contains(event.target as Node) && !activeTarget.contains(event.relatedTarget as Node | null)) hide();
  });
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('resize', hide, { passive: true });
  new MutationObserver(() => {
    if (activeTarget && !doc.body.contains(activeTarget)) hide();
  }).observe(doc.body, { childList: true, subtree: true });
}
