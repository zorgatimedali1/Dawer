/**
 * Full page navigation to the public landing-page demo video section.
 *
 * A hard navigation (not the router) is used on purpose: sign-out leaves the
 * app entirely, the fresh document load carries the `#demo` hash, and the
 * landing page scrolls straight to the video once it has mounted.
 */
export function goToPublicDemo(): void {
  window.location.assign('/#demo');
}
