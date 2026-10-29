import { useTouchZoomReset } from '@/features/site/site-hooks';
import { SiteFooter } from '@/features/site/SiteFooter';
import { TMDBAttribution } from '@/features/releases/TMDBAttribution';
import '@/features/site/supporters.css';
import { useTranslation } from 'react-i18next';

// Supporters: the people and projects LeLibrary stands on. Tracked and served
// on every install (it carries the TMDB attribution the Terms of Use require,
// with the official mark unmodified and secondary to LeLibrary's brand). Names,
// handles and project titles stay verbatim in every language. Credits only link
// to a project's own public page; ones without one are named without a link.

interface Credit { name: string; href?: string }

// The artists whose images ship with LeLibrary (badge packs in the stream
// formatter; since 5.8 every collection cover is LeLibrary's own). Keep in step
// with README "Special thanks" and collection-assets/ASSET_SOURCES.md.
const ARTISTS: { handle: string; work: string; href: string; role: string }[] = [
  { handle: 'vowl313', work: 'NardBadges', href: 'https://github.com/vowl313/NardBadges', role: 'badges' },
  { handle: 'leonevz', work: 'Elite Badges', href: 'https://github.com/leonevz/Elite-Badges', role: 'badges' },
  { handle: 'sweatycab', work: 'Nuvio Minimalist Badges', href: 'https://github.com/sweatycab/nuvio-minimalist-badges', role: 'badges' },
  { handle: '9mousaa', work: 'BetterFormatter', href: 'https://github.com/9mousaa/BetterFormatter', role: 'formatter' },
];

const CREDIT_GROUPS: { key: string; icon: string; items: Credit[] }[] = [
  {
    key: 'data',
    icon: '◎',
    items: [
      { name: 'TMDB', href: 'https://www.themoviedb.org/' },
      { name: 'TMDB Addon on ElfHosted', href: 'https://tmdb.elfhosted.com/' },
      { name: 'TheTVDB', href: 'https://thetvdb.com/' },
      { name: 'OMDb API', href: 'https://www.omdbapi.com/' },
      { name: 'MDBList', href: 'https://mdblist.com/' },
    ],
  },
  {
    key: 'artwork',
    icon: '▣',
    items: [
      { name: 'RPDB', href: 'https://ratingposterdb.com/' },
      { name: 'Fanart.tv', href: 'https://fanart.tv/' },
      { name: 'BetterPosters', href: 'https://btttr.cc/' },
      { name: 'ERDB' },
      { name: 'Pictorium' },
      { name: 'Posters+', href: 'https://github.com/UmbraProjects/PostersPlus' },
    ],
  },
  {
    key: 'streams',
    icon: '≋',
    items: [
      { name: 'Torrentio', href: 'https://torrentio.strem.fun/' },
      { name: 'Comet', href: 'https://comet.feels.legal/' },
      { name: 'Meteor', href: 'https://meteorfortheweebs.midnightignite.me/' },
      { name: 'MediaFusion', href: 'https://mediafusion.elfhosted.com/' },
      { name: 'Jackettio', href: 'https://jackettio.elfhosted.com/' },
      { name: 'KNABEN', href: 'https://knaben.org/' },
    ],
  },
  {
    key: 'formatting',
    icon: '✦',
    items: [
      { name: 'AIOStreams', href: 'https://github.com/Viren070/AIOStreams' },
      { name: 'BetterFormatter', href: 'https://github.com/9mousaa/BetterFormatter' },
    ],
  },
];

const PROJECT_COUNT = new Set(CREDIT_GROUPS.flatMap((group) => group.items.map((item) => item.name))).size;

function Monogram({ name }: { name: string }) {
  // A deterministic hue per handle, so every artist card has its own accent
  // without fetching avatars from a third party.
  const hue = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
  return (
    <span className="sp-mono" aria-hidden="true" style={{ background: `linear-gradient(140deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 38%))` }}>
      {name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()}
    </span>
  );
}

export function SupportersPage() {
  const { t } = useTranslation('site');
  useTouchZoomReset();

  return (
    <>
      <main className="sp-page" id="main-content">
        <header className="sp-hero">
          <span className="sp-eyebrow">{t('supporters.eyebrow')}</span>
          <h1>
            {t('supporters.titleLead')}
            <span>{t('supporters.titleAccent')}</span>
          </h1>
          <p className="sp-lede">{t('supporters.lede')}</p>
          <p className="sp-mission">{t('supporters.mission')}</p>
          <ul className="sp-stats">
            <li><strong>{ARTISTS.length}</strong>{t('supporters.statArtists')}</li>
            <li><strong>{PROJECT_COUNT}</strong>{t('supporters.statProjects')}</li>
            <li><strong>2</strong>{t('supporters.statPlayers')}</li>
          </ul>
        </header>

        <section className="sp-section" aria-labelledby="sp-players">
          <div className="sp-head">
            <span className="sp-eyebrow">{t('supporters.playersEyebrow')}</span>
            <h2 id="sp-players">{t('supporters.playersTitle')}</h2>
          </div>
          <div className="sp-players">
            <a className="sp-player is-stremio" href="https://www.stremio.com/" target="_blank" rel="noopener">
              <img src="/stremio.svg" alt="" width="44" height="44" />
              <span><strong>Stremio</strong><em>{t('supporters.stremioText')}</em></span>
              <i aria-hidden="true">↗</i>
            </a>
            <a className="sp-player is-nuvio" href="https://nuvio.tv/" target="_blank" rel="noopener">
              <img src="/nuvio.png" alt="" width="44" height="44" />
              <span><strong>Nuvio</strong><em>{t('supporters.nuvioText')}</em></span>
              <i aria-hidden="true">↗</i>
            </a>
          </div>
        </section>

        <section className="sp-section" aria-labelledby="sp-artists">
          <div className="sp-head">
            <span className="sp-eyebrow">{t('supporters.artistsEyebrow')}</span>
            <h2 id="sp-artists">{t('supporters.artistsTitle')}</h2>
            <p>{t('supporters.artistsLede')}</p>
          </div>
          <ul className="sp-artists">
            {ARTISTS.map((artist) => (
              <li key={`${artist.handle}-${artist.work}`}>
                <a className="sp-artist" href={artist.href} target="_blank" rel="noopener">
                  <Monogram name={artist.handle} />
                  <span className="sp-artist-text">
                    <strong>{artist.handle}</strong>
                    <span>{t(`supporters.role.${artist.role}`)}</span>
                    <em>{artist.work}<span aria-hidden="true"> ↗</span></em>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="sp-small">{t('supporters.artistsNote')}</p>
        </section>

        <section className="sp-section" aria-labelledby="sp-projects">
          <div className="sp-head">
            <span className="sp-eyebrow">{t('supporters.projectsEyebrow')}</span>
            <h2 id="sp-projects">{t('supporters.projectsTitle')}</h2>
            <p>{t('supporters.projectsLede')}</p>
          </div>
          <div className="sp-groups">
            {CREDIT_GROUPS.map((group) => (
              <div className="sp-group" key={group.key}>
                <span className="sp-group-icon" aria-hidden="true">{group.icon}</span>
                <h3>{t(`supporters.group.${group.key}`)}</h3>
                <p>{t(`supporters.groupText.${group.key}`)}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.name}>
                      {item.href
                        ? <a href={item.href} target="_blank" rel="noopener">{item.name}<span aria-hidden="true"> ↗</span></a>
                        : <span>{item.name}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="sp-section" aria-labelledby="sp-join">
          <div className="sp-head">
            <span className="sp-eyebrow">{t('supporters.joinEyebrow')}</span>
            <h2 id="sp-join">{t('supporters.joinTitle')}</h2>
          </div>
          <div className="sp-join">
            <a className="sp-card" href="https://github.com/leleasley/LeLibrary" target="_blank" rel="noopener">
              <strong>{t('supporters.openSource')}</strong>
              <span>{t('supporters.openSourceText')}</span>
              <em>GitHub ↗</em>
            </a>
            <a className="sp-card" href="https://discord.gg/E3XbsmuQ9E" target="_blank" rel="noopener">
              <strong>{t('supporters.community')}</strong>
              <span>{t('supporters.communityText')}</span>
              <em>Discord ↗</em>
            </a>
            <a className="sp-card" href="https://www.reddit.com/r/LeLibrary/" target="_blank" rel="noopener">
              <strong>{t('supporters.news')}</strong>
              <span>{t('supporters.newsText')}</span>
              <em>r/LeLibrary ↗</em>
            </a>
          </div>
        </section>

        <p className="sp-note">{t('supporters.disclaimer')}</p>
        <TMDBAttribution />
      </main>
      <SiteFooter />
    </>
  );
}
