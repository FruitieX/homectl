/**
 * The homelab gateway injects the feedback-hub widget (a corner "Feedback"
 * button) into homectl pages for LAN/VPN clients. Paired wall displays have
 * no one to write feedback, so they hide it through the widget's API.
 */

type FeedbackHubApi = {
  hideButton(): void;
  showButton(): void;
};

declare global {
  interface Window {
    FeedbackHub?: FeedbackHubApi;
  }
}

/**
 * Hides (or shows) the feedback button, now if the widget has loaded or as
 * soon as it does. Returns a cleanup that stops waiting for the widget.
 */
export function setFeedbackButtonHidden(hidden: boolean): () => void {
  const apply = () => {
    try {
      if (hidden) window.FeedbackHub?.hideButton();
      else window.FeedbackHub?.showButton();
    } catch {
      /* the widget is optional; never break the app over it */
    }
  };
  if (window.FeedbackHub) {
    apply();
    return () => {};
  }
  window.addEventListener('feedbackhub:ready', apply, { once: true });
  return () => window.removeEventListener('feedbackhub:ready', apply);
}
