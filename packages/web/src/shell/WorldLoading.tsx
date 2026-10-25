import './world-loading.css';

/**
 * Designed loading state for the world page: the night sky the village will open on (gradient, a few stars,
 * a pixel moon, a stepped "Opening the village" line) at the page's full height, so there is no blank panel
 * while the route chunk and Phaser load. Used as the Suspense fallback for the village route and by the page itself.
 */
export function WorldLoading({ label = 'Opening the village' }: { label?: string }) {
  return (
    <div className="sq-world-loading" role="status" aria-live="polite">
      <span className="sq-world-loading__stars" aria-hidden="true" />
      <span className="sq-world-loading__moon" aria-hidden="true" />
      <span className="sq-world-loading__hills" aria-hidden="true" />
      <p className="sq-world-loading__label">
        {label}
        <span className="sq-world-loading__dots" aria-hidden="true" />
      </p>
    </div>
  );
}
