/**
 * Hands the browser over to WhatsApp. The popup is opened while the click is
 * still within the browser's activation window; if a blocker ate it we fall
 * back to navigating the current tab so the customer never dead-ends.
 */
export function openWhatsApp(url: string): void {
  const opened = window.open(url, '_blank', 'noopener');

  if (!opened) {
    window.location.assign(url);
  }
}
