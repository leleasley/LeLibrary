// Episode "display label" helper. Some shows publish placeholder titles that
// carry no information: empty names, "Episode 25"-style numbering, or daily
// shows whose name is just the air date ("Thursday, October 8, 2026"). Those
// must not be shown as an episode title. Pure and shared by the API so the day
// view and season lists stay consistent.
export interface EpisodeLabelApi {
  isGenericEpisodeName: (name: unknown) => boolean;
}

const MONTHS = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'i');
const DAY_MONTH_YEAR = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\.?,?\\s+\\d{4}\\b`, 'i');
const NUMERIC_DATE = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EPISODE_NUMBER = /^(episode|ep\.?|chapter|part)\s*#?\s*\d+$/i;

function isGenericEpisodeName(name: unknown): boolean {
  if (typeof name !== 'string') return true;
  const value = name.trim();
  if (!value) return true;
  if (EPISODE_NUMBER.test(value)) return true;
  if (ISO_DATE.test(value)) return true;
  if (NUMERIC_DATE.test(value)) return true;
  if (MONTH_DAY_YEAR.test(value)) return true;
  if (DAY_MONTH_YEAR.test(value)) return true;
  return false;
}

module.exports = { isGenericEpisodeName } satisfies EpisodeLabelApi;
