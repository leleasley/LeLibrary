import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Walkthrough videos for each setup tier. The files are hosted-only (a
// gitignored folder under public/guide/videos, shipped with the hosted build),
// so self-hosted installs have no manifest and this renders nothing at all.
export interface GuideVideo {
  tier: 'quick' | 'partial' | 'full';
  src: string;
  poster?: string;
  duration?: string;
}

const MANIFEST_URL = '/guide/videos/videos.json';
const ORDER: GuideVideo['tier'][] = ['quick', 'partial', 'full'];

export function parseGuideVideos(data: unknown): GuideVideo[] {
  const list = (data && typeof data === 'object' && Array.isArray((data as { videos?: unknown }).videos))
    ? (data as { videos: unknown[] }).videos : [];
  return list.flatMap((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const tier = item['tier'];
    const src = item['src'];
    if ((tier !== 'quick' && tier !== 'partial' && tier !== 'full') || typeof src !== 'string' || !src.startsWith('/guide/videos/')) return [];
    const video: GuideVideo = { tier, src };
    if (typeof item['poster'] === 'string' && item['poster'].startsWith('/guide/videos/')) video.poster = item['poster'];
    if (typeof item['duration'] === 'string') video.duration = item['duration'];
    return [video];
  }).sort((a, b) => ORDER.indexOf(a.tier) - ORDER.indexOf(b.tier));
}

// The whole-app overview shown from the home page hero. Same hosted-only
// manifest, as an optional top-level "overview" entry.
export interface OverviewVideo {
  src: string;
  poster?: string;
  duration?: string;
}

export function parseOverviewVideo(data: unknown): OverviewVideo | null {
  const raw = data && typeof data === 'object' ? (data as { overview?: unknown }).overview : null;
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const src = item['src'];
  if (typeof src !== 'string' || !src.startsWith('/guide/videos/')) return null;
  const video: OverviewVideo = { src };
  if (typeof item['poster'] === 'string' && item['poster'].startsWith('/guide/videos/')) video.poster = item['poster'];
  if (typeof item['duration'] === 'string') video.duration = item['duration'];
  return video;
}

export function GuideVideos() {
  const { t } = useTranslation('site');
  const [videos, setVideos] = useState<GuideVideo[]>([]);
  const [active, setActive] = useState<GuideVideo['tier'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL, { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const parsed = parseGuideVideos(data);
        setVideos(parsed);
        setActive(parsed.find((video) => video.tier === 'partial')?.tier ?? parsed[0]?.tier ?? null);
      })
      .catch(() => { /* no videos on this instance */ });
    return () => { cancelled = true; };
  }, []);

  const current = videos.find((video) => video.tier === active);
  if (!current) return null;

  return (
    <div className="gd-videos">
      <div className="gd-videos-head">
        <div>
          <span className="section-eyebrow">{t('guide.videos.eyebrow')}</span>
          <h3>{t('guide.videos.title')}</h3>
          <p>{t('guide.videos.lede')}</p>
        </div>
        <div className="gd-video-tabs" role="tablist" aria-label={t('guide.videos.title')}>
          {videos.map((video) => (
            <button
              key={video.tier} type="button" role="tab" aria-selected={video.tier === active}
              className={video.tier === active ? 'is-active' : ''}
              onClick={() => setActive(video.tier)}
            >
              <strong>{t(`guide.videos.tiers.${video.tier}`)}</strong>
              {video.duration && <small>{video.duration}</small>}
            </button>
          ))}
        </div>
      </div>
      <div className="gd-video-frame">
        <video
          key={current.src}
          controls muted playsInline preload="none"
          {...(current.poster ? { poster: current.poster } : {})}
          aria-label={t(`guide.videos.tiers.${current.tier}`)}
        >
          <source src={current.src} type="video/mp4" />
        </video>
      </div>
    </div>
  );
}
