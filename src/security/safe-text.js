export function setSafeText(element, value) {
  if (!element) return;
  element.textContent = String(value ?? '');
}
