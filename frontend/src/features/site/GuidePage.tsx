import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useActiveSection, useTouchZoomReset } from '@/features/site/site-hooks';
import { SiteFooter } from '@/features/site/SiteFooter';
import { GuideVideos } from '@/features/site/GuideVideos';
import { PosterWall } from '@/features/setup/shared/tier/TierChrome';
import '@/features/setup/shared/tier/tier.css';
import '@/features/site/guide.css';
import { useTranslation } from 'react-i18next';
import { LocalizedCopy } from '@/i18n/LocalizedCopy';

// The field guide for the v5.5 setup model: UUID + password, three tiers, no
// accounts. Content is written for users, not developers, and deliberately
// describes the real surfaces (Quick Look / Settle In / Move In). The page is
// tracked in git so self-hosted installs get the same help, which is why it
// carries its own stylesheet instead of borrowing the private site css.

interface GuideTopic {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
}

const TOPICS: GuideTopic[] = [
  {
    id: 'start',
    title: 'Start here',
    summary: 'What LeLibrary does and which of the three setup depths is right for you.',
    keywords: ['intro', 'overview', 'tiers', 'quick', 'settle', 'move', 'depth', 'choose', 'what is lelibrary'],
  },
  {
    id: 'create',
    title: 'Create your setup',
    summary: 'The three tiers end to end: pick a depth, add keys, set a password, copy your manifest.',
    keywords: ['create', 'setup', 'wizard', 'manifest', 'password', 'uuid', 'tier', 'start', 'install link'],
  },
  {
    id: 'keys',
    title: 'Connect your services',
    summary: 'Debrid keys, the TMDB key, and the optional artwork and list services.',
    keywords: ['keys', 'api', 'torbox', 'real-debrid', 'alldebrid', 'premiumize', 'tmdb', 'tvdb', 'mdblist', 'verify', 'erdb', 'rpdb', 'omdb', 'fanart', 'pictorium'],
  },
  {
    id: 'install',
    title: 'Install in Stremio and Nuvio',
    summary: 'Paste the manifest link into your player, or push it straight from Move In.',
    keywords: ['install', 'stremio', 'nuvio', 'addon', 'manifest', 'push', 'player', 'device', 'profile'],
  },
  {
    id: 'streams',
    title: 'Streams and formatting',
    summary: 'How stream rows read, the filters that trim them, and where extra sources come from.',
    keywords: ['streams', 'format', 'formatting', 'preset', 'badges', 'filters', 'quality', 'resolution', 'size', 'cached', 'custom', 'addons', 'torrentio', 'comet', 'meteor', 'mediafusion', 'jackettio', 'knaben', 'aiostreams', 'zip', 'archive', 'http 400', 'blocked source'],
  },
  {
    id: 'home',
    title: 'Home rows and collections',
    summary: 'Choose the rows you actually watch and build folders that live in Nuvio.',
    keywords: ['home', 'rows', 'collections', 'folders', 'franchise', 'quick packs', 'artwork', 'nuvio', 'catalogues', 'main meta', 'tmdb enrichment', 'tt ids'],
  },
  {
    id: 'edit',
    title: 'Edit, protect or delete',
    summary: 'Open a saved setup later, change it behind your password, or wipe it entirely.',
    keywords: ['edit', 'unlock', 'password', 'save', 'change', 'delete', 'forget', 'id', 'recover'],
  },
  {
    id: 'privacy',
    title: 'Privacy and safety',
    summary: 'What the server stores, what your link means, and how to use support safely.',
    keywords: ['privacy', 'security', 'safe', 'keys', 'sealed', 'encrypted', 'support', 'share', 'link'],
  },
  {
    id: 'troubleshoot',
    title: 'Troubleshooting',
    summary: 'Empty libraries, wrong matches, missing streams, failed pushes and stale caches.',
    keywords: ['troubleshoot', 'fix', 'missing', 'movies', 'shows', 'episodes', 'empty', 'wrong', 'match', 'streams', 'push', 'cache', 'status', 'slow', 'error', 'zip', 'archive', '400', 'no streams'],
  },
];

const TOPIC_IDS = TOPICS.map((topic) => topic.id);

const TIER_ROWS: Array<{ tier: string; href: string; covers: string; best: string }> = [
  {
    tier: 'Quick Look',
    href: '/configure/quick',
    covers: 'Your debrid library, TMDB matching, posters with a live preview, your stream style and Nuvio badge packs.',
    best: 'You want to start watching now and do not care about ordering the home screen yet.',
  },
  {
    tier: 'Settle In',
    href: '/configure/partial',
    covers: 'Everything in Quick Look, plus home rows (Trending, Popular and friends) and stream filters for resolution, size, quality, cached and audio.',
    best: 'Recommended for most people. It gets your home screen and your stream list to look the way you watch.',
  },
  {
    tier: 'Move In',
    href: '/configure/full',
    covers: 'Everything in Settle In, plus the full visual collection wizard, Nuvio collections and artwork management.',
    best: 'You want folders, franchises and cover art, and you are happy to push the result straight to a Nuvio profile.',
  },
];

const CLIENT_ROWS: Array<{ feature: string; stremio: string; nuvio: string }> = [
  { feature: 'Library, discovery and search', stremio: 'Addon catalogues', nuvio: 'Addon catalogues' },
  { feature: 'Home layout', stremio: 'The client controls display', nuvio: 'Your selected profile rows' },
  { feature: 'Collection folders', stremio: 'Catalogue browsing, owned franchises use a genre dropdown', nuvio: 'Native Collections page' },
  { feature: 'Folder art and focus animation', stremio: 'No native equivalent', nuvio: 'Supported collection presentation' },
  { feature: 'Badge packs', stremio: 'Not shown', nuvio: 'Rating badges under each stream' },
];

const SERVICE_ROWS: Array<{ service: string; needed: string; where: string }> = [
  { service: 'TorBox, Real-Debrid, AllDebrid, Premiumize', needed: 'At least one', where: 'Your provider account settings, then copy the API key' },
  { service: 'TMDB', needed: 'Strongly recommended', where: 'themoviedb.org, Settings, API, request a key' },
  { service: 'MDBList', needed: 'Optional', where: 'mdblist.com, account settings' },
  { service: 'TVDB, OMDb, Fanart.tv, RPDB, ERDB', needed: 'Optional', where: 'Each service\u2019s own account page' },
];

const FAQS: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'My library is empty or a new download is missing',
    a: (
      <p>
        Check <Link to="/status">provider status</Link> first. Then confirm the setup is using the key for the
        provider that actually holds the download. Make sure the download is complete and contains a playable
        video file. Active setups refresh in the background, so give a large library a few minutes, then reopen
        the catalogue. A public status page does not check your individual key.
      </p>
    ),
  },
  {
    q: 'A movie or series matched the wrong title',
    a: (
      <p>
        Matching works from the download name. Check that it includes the correct title and year, and season and
        episode information for shows. Renaming it at the provider and waiting for a refresh usually fixes it.
        If it keeps happening, report the expected title and a redacted example filename. Never share a full
        install link or a provider key.
      </p>
    ),
  },
  {
    q: 'I can browse a title but it has no streams',
    a: (
      <p>
        Discovery and curated rows include titles you may not own. Look for your own library copy first, or add an
        external stream addon. If your filters are strict, relax the resolution, size or cached-only rules
        temporarily. A catalogue listing is not a promise of playback.
      </p>
    ),
  },
  {
    q: 'My folders appeared on the wrong Nuvio profile',
    a: (
      <p>
        Open the destination step in Move In, confirm the selected Nuvio profile, and push again. Folder
        definitions are scoped to a profile. Some changes need the Nuvio client refreshed before they show.
      </p>
    ),
  },
  {
    q: 'Nuvio shows basic details and no clickable cast',
    a: (
      <p>
        When you push through LeLibrary, it turns on Nuvio&apos;s built-in TMDB enrichment for the selected profile
        on TV and mobile. For your library rows to use that enrichment, turn on Use Main Meta in LeLibrary so
        eligible titles are served with IMDb IDs. If you installed the manifest manually, check Nuvio&apos;s own
        enrichment setting for the profile you are using.
      </p>
    ),
  },
  {
    q: 'A Nuvio push failed or I was rate limited',
    a: (
      <p>
        Wait a moment before retrying, and check Nuvio first: a request that timed out may have completed anyway.
        If your Nuvio connection expired, reconnect it in the destination step. Folder pushes are limited to four
        per setup per minute, so wait at least a minute after a rate-limit response.
      </p>
    ),
  },
  {
    q: 'A torrent contains a ZIP file, but the video is missing',
    a: (
      <p>
        LeLibrary indexes playable video files such as MKV and MP4. It does not open or extract video files from
        inside a ZIP archive, so an archive by itself will not appear as a playable library item. If the provider
        exposes the extracted video files separately, those can be indexed on a later refresh.
      </p>
    ),
  },
  {
    q: 'Playback shows HTTP 400 or says the source is blocked',
    a: (
      <p>
        Check <Link to="/status">service status</Link>, then try another stream source or your own library copy.
        If the failing source is a TorBox library item, refresh the title and try again after a short wait so a
        fresh playback link can be requested. Re-adding the torrent should not be the first fix. If it keeps
        happening, report which provider and source failed without sharing your install link or API key.
      </p>
    ),
  },
  {
    q: 'Should I clear the cache?',
    a: (
      <p>
        Only after the other checks, and only if data still looks stale. Clearing cached data makes the next
        request rebuild it, which can make browsing briefly slower. It will not repair an invalid key or an
        upstream outage.
      </p>
    ),
  },
];

function GuideSearch() {
  const { t } = useTranslation('site');
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!trimmed) return [];
    const terms = trimmed.split(/\s+/).filter(Boolean);
    return TOPICS.filter((topic) => {
      const haystack = `${t(`guideTopic.${topic.id}.title`)} ${t(`guideTopic.${topic.id}.summary`)} ${topic.keywords.join(' ')}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [trimmed, t]);

  return (
    <div className="gd-search-wrap">
      <label className="gd-search-label" htmlFor="gd-search">{t('guide.find')}</label>
      <input
        id="gd-search"
        className="gd-search"
        type="search"
        placeholder={t('guide.placeholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />
      <div className="gd-results" role="status" aria-live="polite">
        {trimmed && (
          matches.length > 0 ? (
            <ul className="gd-results-list">
              {matches.map((topic) => (
                <li key={topic.id}>
                  <a href={`#${topic.id}`} onClick={() => setQuery('')}>
                    <strong>{t(`guideTopic.${topic.id}.title`)}</strong>
                    <span>{t(`guideTopic.${topic.id}.summary`)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gd-results-empty">{t('guide.noMatch')}</p>
          )
        )}
      </div>
    </div>
  );
}

export function GuidePage() {
  const { t } = useTranslation('site');
  useEffect(() => { document.title = t('guide.documentTitle'); }, [t]);
  useTouchZoomReset();
  // The nav follows the reader: the topic they are inside stays highlighted.
  const activeTopic = useActiveSection(TOPIC_IDS, 96);

  return (
    <LocalizedCopy><div className="site-guide">
      <div className="gd-wall" aria-hidden="true"><PosterWall /></div>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="badge"><span className="badge-dot"></span>{t('guide.badge')}</div>
            <h1 className="hero-title">{t('guide.title')}<br /><em>{t('guide.titleEm')}</em></h1>
            <p className="hero-desc">{t('guide.description')}</p>
            <div className="hero-actions">
              <a className="btn btn-amber" href="/configure">{t('guide.setup')}</a>
              <a className="btn btn-outline" href="#start">{t('guide.read')}</a>
            </div>
          </div>
          <div className="gd-hero-card"><GuideSearch /></div>
        </div>
      </section>

      <div className="gd-layout">
        <nav className="gd-nav" aria-label={t('guide.topics')}>
          <span className="gd-nav-title">{t('guide.onPage')}</span>
          {TOPICS.map((topic) => (
            <a
              key={topic.id}
              href={`#${topic.id}`}
              className={topic.id === activeTopic ? 'is-active' : undefined}
              aria-current={topic.id === activeTopic ? 'true' : undefined}
            >
              {t(`guideTopic.${topic.id}.title`)}
            </a>
          ))}
        </nav>

        <div className="gd-body">
          <section className="gd-section" id="start">
            <div className="section-eyebrow">01 / start here</div>
            <h2>What LeLibrary does</h2>
            <p>
              LeLibrary reads the downloads in your debrid account (TorBox, Real-Debrid, AllDebrid or Premiumize),
              groups series episodes into proper seasons, and matches everything to TMDB so each title has a
              poster, backdrop, rating and description. It also serves discovery rows, search and optional
              collection folders to Stremio and Nuvio.
            </p>
            <p>
              Everything is one addon. There are no accounts, no sign-in and no email. A setup is a random id plus
              an install link, and a password you choose that only guards editing.
            </p>
            <div className="gd-note">
              Public discovery rows let you browse titles you do not own. They are not playable on their own.
              Playback needs an owned file, one of your Custom Streams, or a configured external stream addon.
            </div>

            <h3>Pick a depth</h3>
            <p>
              Every tier produces the same kind of setup and the same install link. The tier only decides how much
              you fill in up front, and you can add the rest later by editing your setup.
            </p>
            <table className="gd-table">
              <thead>
                <tr><th>Tier</th><th>What it covers</th><th>Best for</th></tr>
              </thead>
              <tbody>
                {TIER_ROWS.map((row) => (
                  <tr key={row.tier}>
                    <td><Link to={row.href}>{row.tier}</Link></td>
                    <td>{row.covers}</td>
                    <td>{row.best}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="gd-section" id="create">
            <div className="section-eyebrow">02 / create</div>
            <h2>Create your setup</h2>
            <p>
              Open the <Link to="/configure">setup picker</Link> and choose a tier. The steps below apply to all
              three. Quick Look is a single page; Settle In and Move In walk you through their steps one at a
              time. A live preview of your posters and streams stays beside you the whole way.
            </p>
            <GuideVideos />
            <ol className="gd-steps">
              <li>
                <strong>Add your keys.</strong> Paste at least one debrid provider key and, for the best results,
                a TMDB key. Press the check button beside a field to verify a key live: green means the service
                accepted it, red shows the reason it did not.
              </li>
              <li>
                <strong>Choose your look.</strong> Pick a poster provider and confirm the preview. Settle In and
                Move In add home rows, stream filters and, in Move In, collections and artwork.
              </li>
              <li>
                <strong>Set a password.</strong> The password is the edit gate. Watching never asks for it, and
                nobody can recover it for you, so save it somewhere safe.
              </li>
              <li>
                <strong>Save your setup details.</strong> Copy the install link (the manifest.json URL you give
                your player) and the setup id. You will need the id and password to edit the setup later.
              </li>
            </ol>
            <div className="gd-note">
              A setup needs at least one provider key before it can be created. Custom Streams can run without a
              debrid provider, but you still need one key of any kind to save.
            </div>
          </section>

          <section className="gd-section" id="keys">
            <div className="section-eyebrow">03 / keys</div>
            <h2>Connect your services</h2>
            <p>
              Keys are entered once while creating or editing a setup and are sealed on the server. They are never
              shown back to you. When you reopen a saved setup, the fields arrive filled with your saved values
              (hidden); leave a field alone to keep it, or type a new value to replace it.
            </p>
            <table className="gd-table">
              <thead>
                <tr><th>Service</th><th>Needed?</th><th>Where to find it</th></tr>
              </thead>
              <tbody>
                {SERVICE_ROWS.map((row) => (
                  <tr key={row.service}>
                    <td>{row.service}</td>
                    <td>{row.needed}</td>
                    <td>{row.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Which debrid provider?</h3>
            <p>
              TorBox supports torrents and Usenet. Real-Debrid and AllDebrid cover torrents. Premiumize supports
              torrents and Usenet and may ask you to approve the new server location the first time it is used.
              You can add more than one: either combine them into a single library row or keep a separate row for
              each in Move In.
            </p>
            <h3>About the TMDB key</h3>
            <p>
              TMDB powers matching, posters, episode lists and search. Without it, LeLibrary falls back to
              limited metadata. A free TMDB API key from your TMDB account settings is enough.
            </p>
          </section>

          <section className="gd-section" id="install">
            <div className="section-eyebrow">04 / install</div>
            <h2>Install in Stremio and Nuvio</h2>
            <p>
              The install link is your manifest.json URL. It carries your configuration but not your password, so
              your player needs no sign-in. Treat it as private: anyone who has it can use your setup and its
              connected services.
            </p>
            <h3>Stremio</h3>
            <ol className="gd-steps">
              <li>Copy your install link from the result screen or from your setup editor.</li>
              <li>Open Stremio and find the addon installer, then paste the link as an addon URL.</li>
              <li>Confirm the installation. Opening the link alone does not install it.</li>
            </ol>
            <h3>Nuvio</h3>
            <p>
              Nuvio can read the same install link manually, or you can let Move In push the setup for you. Sign in
              to Nuvio in the destination step, choose the profile you want, and push from the review step. The
              selected profile receives your new setup. Other profiles are left exactly as they are, so each
              person can push their own setup to their own profile.
            </p>
            <table className="gd-table">
              <thead>
                <tr><th>Feature</th><th>Stremio</th><th>Nuvio</th></tr>
              </thead>
              <tbody>
                {CLIENT_ROWS.map((row) => (
                  <tr key={row.feature}>
                    <td>{row.feature}</td>
                    <td>{row.stremio}</td>
                    <td>{row.nuvio}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="gd-section" id="streams">
            <div className="section-eyebrow">05 / streams</div>
            <h2>Streams and formatting</h2>
            <p>
              Every stream row is formatted with a template, so a 62 GB Remux and a 4 GB WEB-DL read the same way.
              Pick a built-in preset or write your own name and description templates in the formatting section.
              The preview updates on a real sample filename as you type.
            </p>
            <h3>Filters</h3>
            <p>
              Filters keep the stream list to what you will actually play: resolution, quality, source, minimum and
              maximum size, cached-only, plus finer codec, HDR and audio sets. They apply to your search results
              and stream lists, not to your library itself.
            </p>
            <h3>Extra stream sources</h3>
            <p>
              Owned copies come first. You can also enable Torrentio, Comet, Meteor, MediaFusion, Jackettio or
              KNABEN, and set their priority. AIOStreams can be connected with its own manifest URL. LeLibrary
              reformats external results with your chosen look. KNABEN searches public torrent results and only
              contacts your selected debrid provider if you choose to play a result.
            </p>
            <h3>Custom Streams</h3>
            <p>
              Custom Streams add your own direct HTTP or HTTPS links to a movie or an individual episode. A profile
              can run entirely from Custom Streams without a debrid provider, as long as you saved at least one key
              of another kind to create the setup.
            </p>
            <h3>Badge packs</h3>
            <p>
              Badge packs add small rating badges (IMDb, Rotten Tomatoes and friends) under each stream in Nuvio.
              They do not change anything in Stremio. Pick one of the ready-made packs or supply your own URL.
            </p>
          </section>

          <section className="gd-section" id="home">
            <div className="section-eyebrow">06 / home and collections</div>
            <h2>Home rows and collections</h2>
            <h3>Home rows</h3>
            <p>
              Home is the ordered list of rows on your home screen. Settle In and Move In let you tick the library
              rows you want (My Movies, My Shows and friends), add discovery rows such as Trending and Popular,
              rename them and drag them into the order you like.
            </p>
            <h3>Use Main Meta</h3>
            <p>
              By default library rows use LeLibrary&apos;s own isolated identifiers, which only LeLibrary answers.
              Turning on Use Main Meta serves eligible library titles with their IMDb IDs instead. That is what
              lets external stream addons answer them and what lets Nuvio enrich their detail pages. You can switch
              it on at any time; no reinstall is needed.
            </p>
            <h3>Collections</h3>
            <p>
              Move In adds the Collections Studio. Build folders by hand, drop in a Quick Pack of ready-made
              collections, or let LeLibrary build owned movie collections from the franchises already in your
              library. Each folder can carry cover art and, in Nuvio, a focus animation. Pushing writes your
              folders to the selected Nuvio profile and leaves every other addon and user collection untouched.
            </p>
            <div className="gd-note">
              Existing Nuvio folders fetch their contents live, so new films appear without another push. A brand
              new franchise or a changed folder definition needs one more push to register. Pushes are limited to
              four per setup per minute.
            </div>
          </section>

          <section className="gd-section" id="edit">
            <div className="section-eyebrow">07 / edit</div>
            <h2>Edit, protect or delete</h2>
            <ol className="gd-steps">
              <li>
                Open your setup id, or paste it on the <Link to="/configure">setup picker</Link>. The id is the part
                of the install link before <code>/manifest.json</code>.
              </li>
              <li>
                The page you created the setup on opens behind a password box, with your setup id already filled
                in. Enter your password and the box fades away.
              </li>
              <li>
                Everything you saved is back in its place: keys (hidden), posters, stream style, home rows,
                collections and folders. Change anything and press Save changes. Nothing changes until you save.
              </li>
              <li>
                Want more or fewer options? Switch the setup type in Setup settings at the bottom of the page.
                Everything carries over, and the install link and setup id stay the same.
              </li>
              <li>
                Delete all your data from Setup settings if you want the setup gone. Installed addon links stop
                working immediately and the sealed keys are removed.
              </li>
            </ol>
            <div className="gd-note">
              The install link and the setup id are shown once when you create the setup. Reopen the setup with
              your password to see the install link again. If you lose both the id and the password, the setup
              cannot be recovered.
            </div>
          </section>

          <section className="gd-section" id="privacy">
            <div className="section-eyebrow">08 / privacy</div>
            <h2>Privacy and safety</h2>
            <p>
              There are no accounts, no cookies, no analytics and no tracking. Provider and metadata keys are
              encrypted with AES-256-GCM before they touch disk and are never displayed back. Your password is
              hashed with scrypt and cannot be recovered by you or by us.
            </p>
            <p>
              Wrong-password attempts are rate limited per address for a few minutes to stop guessing. Those
              counters live in memory only.
            </p>
            <h3>Asking for help safely</h3>
            <p>
              When you ask for support, never post your install link, a provider key, your setup id or a full media
              filename. A screenshot with keys and private links hidden is fine. Ask in the{' '}
              <a href="https://discord.gg/E3XbsmuQ9E" target="_blank" rel="noopener noreferrer">LeLibrary Discord</a>,{' '}
              visit <a href="https://www.reddit.com/r/LeLibrary/" target="_blank" rel="noopener noreferrer">r/LeLibrary</a>,{' '}
              or open a <a href="https://github.com/leleasley/LeLibrary/issues" target="_blank" rel="noopener noreferrer">GitHub issue</a>.
            </p>
            <p>
              Read the <Link to="/privacy">privacy policy</Link> for the full list of what a setup stores and how
              long caches are kept.
            </p>
          </section>

          <section className="gd-section" id="troubleshoot">
            <div className="section-eyebrow">09 / troubleshooting</div>
            <h2>Troubleshooting</h2>
            <p>Most problems fall into one of these. Open the one that matches what you are seeing.</p>
            <div className="gd-faqs">
              {FAQS.map((faq) => (
                <details className="gd-faq" key={faq.q}>
                  <summary>{faq.q}</summary>
                  <div className="gd-faq-body">{faq.a}</div>
                </details>
              ))}
            </div>
            <p className="gd-still-stuck">
              Still stuck? Check <Link to="/status">service status</Link> for upstream outages, then ask on{' '}
              <a href="https://www.reddit.com/r/LeLibrary/" target="_blank" rel="noopener noreferrer">r/LeLibrary</a>{' '}
              or open a GitHub issue.
            </p>
          </section>
        </div>
      </div>

      <SiteFooter />
    </div></LocalizedCopy>
  );
}
