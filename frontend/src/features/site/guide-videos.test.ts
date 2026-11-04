import { describe, expect, it } from 'vitest';
import { parseGuideVideos, parseOverviewVideo } from '@/features/site/GuideVideos';

describe('videos manifest', () => {
  const manifest = {
    videos: [{ tier: 'quick', src: '/guide/videos/quick.mp4', poster: '/guide/videos/quick.jpg', duration: '1:25' }],
    overview: { src: '/guide/videos/overview.mp4', poster: '/guide/videos/overview.jpg', duration: '1:13' },
  };

  it('reads the home page overview next to the tier videos', () => {
    expect(parseOverviewVideo(manifest)).toEqual({ src: '/guide/videos/overview.mp4', poster: '/guide/videos/overview.jpg', duration: '1:13' });
    expect(parseGuideVideos(manifest).map((video) => video.tier)).toEqual(['quick']);
  });

  it('has no overview when the entry is missing or points elsewhere', () => {
    expect(parseOverviewVideo({ videos: [] })).toBeNull();
    expect(parseOverviewVideo(null)).toBeNull();
    expect(parseOverviewVideo({ overview: { src: 'https://evil.example/x.mp4' } })).toBeNull();
    expect(parseOverviewVideo({ overview: { src: '/guide/videos/o.mp4', poster: 'https://evil.example/p.jpg' } })).toEqual({ src: '/guide/videos/o.mp4' });
  });

  it('keeps narration subtitles only from the videos folder', () => {
    const [narrated] = parseGuideVideos({ videos: [{ tier: 'quick', src: '/guide/videos/quick.mp4', captions: '/guide/videos/quick.vtt?v=1' }] });
    expect(narrated?.captions).toBe('/guide/videos/quick.vtt?v=1');
    const [other] = parseGuideVideos({ videos: [{ tier: 'quick', src: '/guide/videos/quick.mp4', captions: 'https://evil.example/x.vtt' }] });
    expect(other?.captions).toBeUndefined();
  });
});
