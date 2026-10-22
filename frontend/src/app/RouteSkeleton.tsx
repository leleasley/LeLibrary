// Page-shaped placeholders shown while a route's chunk and copy load. Each
// variant mirrors the real page's layout (hero, rail, columns, poster grid) so
// nothing jumps when the page arrives. Blocks are aria-hidden; one live region
// announces the load.
import { useTranslation } from 'react-i18next';

export type SkeletonVariant = 'doc' | 'picker' | 'setup' | 'releases';

function Bar({ w, h, className = '' }: { w?: string; h?: number; className?: string }) {
  return <span className={`sk ${className}`} style={{ width: w, height: h }} />;
}

function Hero({ wide }: { wide?: boolean }) {
  return (
    <div className="sk-hero">
      <Bar className="sk-eyebrow" w="110px" h={10} />
      <Bar className="sk-title" w={wide ? '62%' : '48%'} h={38} />
      <Bar className="sk-title" w={wide ? '40%' : '30%'} h={38} />
      <Bar w="56%" h={12} />
      <Bar w="44%" h={12} />
    </div>
  );
}

function Body({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case 'setup':
      return (
        <>
          <div className="sk-rail">
            {Array.from({ length: 7 }, (_, i) => <Bar key={i} className="sk-pill" h={22} />)}
          </div>
          <Hero />
          <div className="sk-setup">
            <div className="sk-col">
              {[0, 1, 2].map((i) => (
                <div className="sk-card sk-step" key={i}>
                  <Bar className="sk-num" w="38px" h={30} />
                  <div className="sk-lines">
                    <Bar w="34%" h={16} />
                    <Bar w="72%" h={10} />
                    <div className="sk-tiles">
                      {[0, 1, 2, 3].map((j) => <Bar key={j} className="sk-tile" h={54} />)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="sk-card sk-aside">
              <Bar w="46%" h={10} />
              <div className="sk-posters"><Bar className="sk-poster" /><Bar className="sk-poster" /></div>
              <Bar w="80%" h={10} />
              <Bar w="64%" h={10} />
              <Bar w="100%" h={40} className="sk-cta" />
            </div>
          </div>
        </>
      );
    case 'picker':
      return (
        <>
          <Hero wide />
          <div className="sk-grid sk-grid-3">
            {[0, 1, 2].map((i) => (
              <div className="sk-card sk-tier" key={i}>
                <Bar w="40%" h={10} />
                <Bar w="60%" h={22} />
                <Bar className="sk-mini" h={120} />
                <Bar w="90%" h={10} />
                <Bar w="70%" h={10} />
                <Bar w="100%" h={40} className="sk-cta" />
              </div>
            ))}
          </div>
        </>
      );
    case 'releases':
      return (
        <>
          <Hero />
          <div className="sk-rail sk-tabs">
            {[0, 1, 2].map((i) => <Bar key={i} className="sk-pill" h={32} />)}
          </div>
          <div className="sk-grid sk-posters-grid">
            {Array.from({ length: 12 }, (_, i) => (
              <div className="sk-poster-item" key={i}>
                <Bar className="sk-poster" />
                <Bar w="80%" h={10} />
                <Bar w="50%" h={10} />
              </div>
            ))}
          </div>
        </>
      );
    default:
      return (
        <>
          <Hero wide />
          <div className="sk-doc">
            <div className="sk-toc">
              {Array.from({ length: 6 }, (_, i) => <Bar key={i} w={`${60 + ((i * 17) % 35)}%`} h={10} />)}
            </div>
            <div className="sk-col">
              {[0, 1].map((i) => (
                <div className="sk-card" key={i}>
                  <Bar w="38%" h={18} />
                  <Bar w="94%" h={10} />
                  <Bar w="88%" h={10} />
                  <Bar w="70%" h={10} />
                </div>
              ))}
            </div>
          </div>
        </>
      );
  }
}

export function RouteSkeleton({ variant = 'doc', label }: { variant?: SkeletonVariant; label?: string }) {
  const { t } = useTranslation('common');
  return (
    <div className={`route-skeleton sk-${variant}-page`}>
      <div className="route-skeleton-inner" aria-hidden="true">
        <Body variant={variant} />
      </div>
      <span className="sk-visually-hidden" role="status" aria-live="polite">{label ?? t('loading.page')}</span>
    </div>
  );
}
