(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeFormatter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── sentinels ──────────────────────────────────────────────────────────────
  const NEW_LINE_SENTINEL = '\u0011';
  const REMOVE_LINE_SENTINEL = '\u0012';
  const SENTINEL_PATTERN = /[\u0011\u0012]/g;
  function hasSentinel(text) {
    return text.includes(NEW_LINE_SENTINEL) || text.includes(REMOVE_LINE_SENTINEL);
  }
  function sanitise(text) {
    return hasSentinel(text) ? text.replace(SENTINEL_PATTERN, '') : text;
  }
  function substituteTools(text) {
    return String(text)
      .replaceAll('{tools.newLine}', NEW_LINE_SENTINEL)
      .replaceAll('{tools.removeLine}', REMOVE_LINE_SENTINEL);
  }

  // ── utils ──────────────────────────────────────────────────────────────────
  function formatBytes(bytes, k, round) {
    if (!bytes || bytes === 0) return '0 B';
    const sizes = k === 1024 ? ['B','KiB','MiB','GiB','TiB'] : ['B','KB','MB','GB','TB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    let value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
    if (round) value = Math.round(value);
    return value + ' ' + sizes[i];
  }
  function formatSmartBytes(bytes, k) {
    if (!bytes || bytes === 0) return '0 B';
    const sizes = k === 1024 ? ['B','KiB','MiB','GiB','TiB'] : ['B','KB','MB','GB','TB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    const rawValue = bytes / Math.pow(k, i);
    const integerPart = Math.floor(rawValue);
    let value;
    let formattedValue;
    if (integerPart >= 100) { value = Math.round(rawValue); formattedValue = value.toString(); }
    else if (integerPart >= 10) { value = parseFloat(rawValue.toFixed(1)); formattedValue = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1); }
    else { value = parseFloat(rawValue.toFixed(2)); formattedValue = value.toString(); }
    return formattedValue + ' ' + sizes[i];
  }
  function formatBitrate(bitrate, round) {
    if (!Number.isFinite(bitrate) || bitrate <= 0) return '0 bps';
    const k = 1000; const sizes = ['bps','Kbps','Mbps','Gbps','Tbps'];
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bitrate) / Math.log(k))));
    let value = bitrate / Math.pow(k, i);
    value = round ? Math.round(value) : parseFloat(value.toFixed(2));
    return `${value} ${sizes[i]}`;
  }
  function formatSmartBitrate(bitrate) {
    if (!Number.isFinite(bitrate) || bitrate <= 0) return '0 bps';
    const k = 1000; const sizes = ['bps','Kbps','Mbps','Gbps','Tbps'];
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bitrate) / Math.log(k))));
    const rawValue = bitrate / Math.pow(k, i);
    const integerPart = Math.floor(rawValue);
    let value; let formattedValue;
    if (integerPart >= 100) { value = Math.round(rawValue); formattedValue = value.toString(); }
    else if (integerPart >= 10) { value = parseFloat(rawValue.toFixed(1)); formattedValue = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1); }
    else { value = parseFloat(rawValue.toFixed(2)); formattedValue = value.toString(); }
    return `${formattedValue} ${sizes[i]}`;
  }
  function formatDuration(durationInMs) {
    const seconds = Math.max(0, Math.floor(durationInMs / 1000));
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h:${minutes % 60}m:${seconds % 60}s`;
    if (seconds % 60 > 0) return `${minutes % 60}m:${seconds % 60}s`;
    return `${minutes % 60}m`;
  }
  function normaliseDuration(d) {
    if (d < 0) return 0;
    if (d < 1000) return d * 60 * 1000;
    return d;
  }
  const DURATION_UNITS = ['H', 'M', 'S'];
  function renderPattern(pattern, resolve) {
    const stack = [{ text: '', zero: true, sawToken: false }];
    const closeGroup = () => {
      const group = stack.pop();
      const parent = stack[stack.length - 1];
      if (!group.sawToken || !group.zero) {
        parent.text += group.text;
        parent.sawToken = parent.sawToken || group.sawToken;
        if (!group.zero) parent.zero = false;
      }
    };
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      const top = stack[stack.length - 1];
      if (char === '%') {
        const next = pattern[i + 1];
        if (next === undefined) { top.text += '%'; break; }
        if (next === '%' || next === '[' || next === ']') { top.text += next; i += 1; continue; }
        const token = next === '-' ? pattern.slice(i + 1, i + 3) : next;
        const resolved = resolve(token);
        if (resolved === undefined) top.text += `%${token}`;
        else { top.text += resolved.text; top.sawToken = true; if (!resolved.zero) top.zero = false; }
        i += token.length;
        continue;
      }
      if (char === '[') { stack.push({ text: '', zero: true, sawToken: false }); continue; }
      if (char === ']' && stack.length > 1) { closeGroup(); continue; }
      top.text += char;
    }
    while (stack.length > 1) closeGroup();
    return stack[0].text;
  }
  function formatDurationPattern(durationInMs, pattern) {
    const units = new Set();
    renderPattern(pattern, (token) => {
      const unit = token.startsWith('-') ? token.slice(1) : token;
      if (!DURATION_UNITS.includes(unit)) return undefined;
      units.add(unit);
      return { text: '' };
    });
    const totalSeconds = Math.max(0, Math.floor(durationInMs / 1000));
    const totalMinutes = Math.floor(totalSeconds / 60);
    const values = {
      H: Math.floor(totalSeconds / 3600),
      M: units.has('H') ? totalMinutes % 60 : totalMinutes,
      S: units.has('H') || units.has('M') ? totalSeconds % 60 : totalSeconds,
    };
    return renderPattern(pattern, (token) => {
      const padded = !token.startsWith('-');
      const value = values[padded ? token : token.slice(1)];
      if (value === undefined) return undefined;
      return { text: padded ? String(value).padStart(2, '0') : String(value), zero: value === 0 };
    });
  }
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  function ordinalise(day) {
    const teens = day % 100;
    if (teens >= 11 && teens <= 13) return `${day}th`;
    switch (day % 10) { case 1: return `${day}st`; case 2: return `${day}nd`; case 3: return `${day}rd`; default: return `${day}th`; }
  }
  function formatDatePattern(value, pattern) {
    const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value).trim());
    if (!parts) return String(value);
    const [year, month, day] = [Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])];
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return String(value);
    const tokens = {
      Y: String(year), y: String(year % 100).padStart(2, '0'),
      m: String(month + 1).padStart(2, '0'), '-m': String(month + 1),
      d: String(day).padStart(2, '0'), '-d': String(day), o: ordinalise(day),
      B: MONTH_NAMES[month], b: MONTH_NAMES[month].slice(0, 3),
      A: DAY_NAMES[date.getUTCDay()], a: DAY_NAMES[date.getUTCDay()].slice(0, 3),
    };
    return renderPattern(pattern, (token) => tokens[token] !== undefined ? { text: tokens[token] } : undefined);
  }
  function formatHours(hours) { return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`; }
  const SMALL_CAPS_MAP = { A:'ᴀ',B:'ʙ',C:'ᴄ',D:'ᴅ',E:'ᴇ',F:'ғ',G:'ɢ',H:'ʜ',I:'ɪ',J:'ᴊ',K:'ᴋ',L:'ʟ',M:'ᴍ',N:'ɴ',O:'ᴏ',P:'ᴘ',Q:'ǫ',R:'ʀ',S:'ꜱ',T:'ᴛ',U:'ᴜ',V:'ᴠ',W:'ᴡ',X:'x',Y:'ʏ',Z:'ᴢ' };
  function makeSmall(code) {
    return String(code).split('').map((char) => SMALL_CAPS_MAP[char.toUpperCase()] || char).join('');
  }

  // ── languages (common subset) ──────────────────────────────────────────────
  const LANG_CODE = {
    english: 'EN', portuguese: 'PT', spanish: 'ES', french: 'FR', german: 'DE',
    italian: 'IT', japanese: 'JA', korean: 'KO', chinese: 'ZH', hindi: 'HI',
    arabic: 'AR', russian: 'RU', dutch: 'NL', polish: 'PL', turkish: 'TR',
    swedish: 'SV', norwegian: 'NO', danish: 'DA', finnish: 'FI', czech: 'CS',
    greek: 'EL', hebrew: 'HE', thai: 'TH', vietnamese: 'VI', indonesian: 'ID',
    hungarian: 'HU', romanian: 'RO', ukrainian: 'UK', catalan: 'CA', brazilian: 'PT',
  };
  const LANG_EMOJI = {
    english: '🇬🇧', portuguese: '🇵🇹', spanish: '🇪🇸', french: '🇫🇷', german: '🇩🇪',
    italian: '🇮🇹', japanese: '🇯🇵', korean: '🇰🇷', chinese: '🇨🇳', hindi: '🇮🇳',
    arabic: '🇸🇦', russian: '🇷🇺', dutch: '🇳🇱', polish: '🇵🇱', turkish: '🇹🇷',
    swedish: '🇸🇪', norwegian: '🇳🇴', danish: '🇩🇰', finnish: '🇫🇮', czech: '🇨🇿',
    greek: '🇬🇷', hebrew: '🇮🇱', thai: '🇹🇭', vietnamese: '🇻🇳', indonesian: '🇮🇩',
    hungarian: '🇭🇺', romanian: '🇷🇴', ukrainian: '🇺🇦', catalan: '🏴󠁥󠁳󠁣󠁴󠁿', brazilian: '🇧🇷',
  };
  function normaliseLanguage(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z]+/g, ' ');
  }
  function languageToCode(name) {
    const key = normaliseLanguage(name);
    if (LANG_CODE[key]) return LANG_CODE[key];
    const match = Object.keys(LANG_CODE).find((k) => key.includes(k) || k.includes(key));
    return match ? LANG_CODE[match] : undefined;
  }
  function languageToEmoji(name) {
    const key = normaliseLanguage(name);
    if (LANG_EMOJI[key]) return LANG_EMOJI[key];
    const match = Object.keys(LANG_EMOJI).find((k) => key.includes(k) || k.includes(key));
    return match ? LANG_EMOJI[match] : undefined;
  }

  // ── modifiers ──────────────────────────────────────────────────────────────
  const MAX_RENDER_LENGTH = 8000;
  function replaceAll(value, search, replacement) {
    if (!search) return value;
    const growth = replacement.length - search.length;
    const worstCase = growth <= 0 ? value.length : value.length + Math.floor(value.length / search.length) * growth;
    if (worstCase <= MAX_RENDER_LENGTH) return value.replaceAll(search, replacement);
    let out = ''; let from = 0;
    while (out.length < MAX_RENDER_LENGTH) {
      const at = value.indexOf(search, from);
      if (at === -1) { out += value.slice(from); break; }
      out += value.slice(from, at) + replacement;
      from = at + search.length;
    }
    return out.length > MAX_RENDER_LENGTH ? out.slice(0, MAX_RENDER_LENGTH) : out;
  }
  const DIGITS = '0123456789+-=()';
  const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎';
  const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾';
  function mapChars(value, from, to) {
    const table = new Map();
    const source = [...from]; const target = [...to];
    for (let i = 0; i < source.length && i < target.length; i++) table.set(source[i], target[i]);
    return [...value].map((char) => table.get(char) ?? char).join('');
  }
  const toLanguageCode = (value) => { const name = normaliseLanguage(value) || String(value); return languageToCode(name) || name.toUpperCase(); };
  const toLanguageEmoji = (value) => { const name = normaliseLanguage(value) || String(value); return languageToEmoji(name) || ''; };
  const mapLanguages = (value, convert) => [...new Set(value.map((item) => convert(String(item))).filter(Boolean))];

  const stringModifiers = {
    upper: (v) => String(v).toUpperCase(),
    lower: (v) => String(v).toLowerCase(),
    title: (v) => String(v).split(' ').map((w) => w.toLowerCase()).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    length: (v) => String(v).length.toString(),
    reverse: (v) => String(v).split('').reverse().join(''),
    string: (v) => String(v),
    smallcaps: (v) => makeSmall(String(v)),
    subscript: (v) => mapChars(String(v), DIGITS, SUBSCRIPT_DIGITS),
    superscript: (v) => mapChars(String(v), DIGITS, SUPERSCRIPT_DIGITS),
    languagecode: toLanguageCode,
    languageemoji: toLanguageEmoji,
  };
  const arrayModifiers = {
    join: (v) => v.join(', '),
    length: (v) => v.length.toString(),
    first: (v) => v.length > 0 ? String(v[0]) : '',
    last: (v) => v.length > 0 ? String(v[v.length - 1]) : '',
    random: (v) => v.length > 0 ? String(v[Math.floor(Math.random() * v.length)]) : '',
    sort: (v) => [...v].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })),
    rsort: (v) => [...v].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? b - a : String(b).localeCompare(String(a), undefined, { numeric: true })),
    lsort: (v) => [...v].sort(),
    reverse: (v) => [...v].reverse(),
    languagecode: (v) => mapLanguages(v, toLanguageCode),
    languageemoji: (v) => mapLanguages(v, toLanguageEmoji),
    string: (v) => v.toString(),
  };
  const numberModifiers = {
    comma: (v) => v.toLocaleString(),
    hex: (v) => v.toString(16),
    octal: (v) => v.toString(8),
    binary: (v) => v.toString(2),
    bytes: (v) => formatBytes(v, 1000),
    sbytes: (v) => formatSmartBytes(v, 1000),
    sbytes10: (v) => formatSmartBytes(v, 1000),
    sbytes2: (v) => formatSmartBytes(v, 1024),
    rbytes: (v) => formatBytes(v, 1000, true),
    bytes10: (v) => formatBytes(v, 1000),
    rbytes10: (v) => formatBytes(v, 1000, true),
    bytes2: (v) => formatBytes(v, 1024),
    rbytes2: (v) => formatBytes(v, 1024, true),
    bitrate: (v) => formatBitrate(v),
    rbitrate: (v) => formatBitrate(v, true),
    sbitrate: (v) => formatSmartBitrate(v),
    string: (v) => v.toString(),
    time: (v) => formatDuration(normaliseDuration(v)),
    star: (v) => { const full = Math.floor(v / 20); const half = v % 20 >= 10 ? 1 : 0; return '★'.repeat(full) + '⯪'.repeat(half); },
    pstar: (v) => { const full = Math.floor(v / 20); const half = v % 20 >= 10 ? 1 : 0; return '★'.repeat(full) + '⯪'.repeat(half) + '☆'.repeat(5 - full - half); },
  };
  const booleanModifiers = { string: (v) => String(v) };
  const exact = {
    istrue: (v) => v === true,
    isfalse: (v) => v === false,
    exists: (v) => { if (v === undefined || v === null) return false; if (typeof v === 'string') return /\S/.test(v); if (Array.isArray(v)) return v.length > 0; return true; },
  };
  const prefix = {
    '$': (v, check) => typeof v === 'string' ? v.startsWith(check) : (Array.isArray(v) ? v[0] === check : false),
    '^': (v, check) => typeof v === 'string' ? v.endsWith(check) : (Array.isArray(v) ? v[v.length - 1] === check : false),
    '~': (v, check) => typeof v === 'string' ? v.includes(check) : (Array.isArray(v) ? v.includes(check) : false),
    '=': (v, check) => v === check,
    '>=': (v, check) => v >= check,
    '>': (v, check) => v > check,
    '<=': (v, check) => v <= check,
    '<': (v, check) => v < check,
  };
  const plainModifierNames = [...new Set([
    ...Object.keys(stringModifiers), ...Object.keys(numberModifiers),
    ...Object.keys(arrayModifiers), ...Object.keys(booleanModifiers),
    ...Object.keys(exact),
  ])].sort((a, b) => b.length - a.length);
  const prefixOperators = Object.keys(prefix).sort((a, b) => b.length - a.length);
  const CALL_MODIFIERS = [
    ['replace', 'replaceArgs'], ['remove', 'loose'], ['join', 'quoted'], ['truncate', 'digits'],
    ['slice', 'digitsOrPair'], ['time', 'quoted'], ['date', 'quoted'], ['default', 'quoted'],
    ['in', 'loose'], ['translate', 'quotedPair'],
  ];

  function compileConditional(lower) {
    const isExact = Object.prototype.hasOwnProperty.call(exact, lower);
    const operator = prefixOperators.find((op) => lower.startsWith(op));
    if (!isExact && !operator) return undefined;
    const rawCheck = operator ? lower.slice(operator.length) : '';
    const isArrayCapable = operator ? ['$', '^', '~'].includes(operator) : false;
    const isNumericCapable = operator ? ['<', '<=', '>', '>=', '='].includes(operator) : false;
    return (value) => {
      try {
        if (!exact.exists(value)) return false;
        if (isExact) return exact[lower](value);
        const arrayValue = Array.isArray(value) && value.every((item) => typeof item === 'string')
          ? value.map((item) => item.toLowerCase()) : undefined;
        const stringValue = String(value).toLowerCase();
        const check = /\s/.test(stringValue) ? rawCheck : rawCheck.replace(/\s/g, '');
        const numericValue = Number(stringValue.replace(/,\s/g, ''));
        const numericCheck = Number(check.replace(/,\s/g, ''));
        const numeric = isNumericCapable && !isNaN(numericValue) && !isNaN(numericCheck);
        return prefix[operator](numeric ? numericValue : ((isArrayCapable ? arrayValue : undefined) ?? stringValue), numeric ? numericCheck : check);
      } catch { return false; }
    };
  }

  function quotedArguments(inner) {
    const args = [];
    const pattern = /"([^"]*)"|'([^']*)'/g;
    let match;
    while ((match = pattern.exec(inner)) !== null) args.push(match[1] ?? match[2] ?? '');
    return args;
  }
  function unquote(arg) {
    const quote = arg[0];
    return arg.length >= 2 && (quote === "'" || quote === '"') && arg.endsWith(quote) ? arg.slice(1, -1) : undefined;
  }

  function compileParameterised(source, lower) {
    const open = source.indexOf('(');
    if (open === -1 || !source.endsWith(')')) return undefined;
    const name = lower.slice(0, open);
    const inner = source.slice(open + 1, -1);
    switch (name) {
      case 'replace': {
        const variableForm = /^\s*\{([^}]+)\}\s*,\s*(['"])([\s\S]*)\2\s*$/.exec(inner);
        if (variableForm) {
          const [, variablePath, , rawReplacement] = variableForm;
          const replacementText = substituteTools(rawReplacement);
          return (value, parseValue, ctx) => {
            if (typeof value !== 'string') return undefined;
            const resolved = ctx.resolveVariable(variablePath, parseValue);
            return resolved ? replaceAll(value, resolved, replacementText) : value;
          };
        }
        const openQuote = source.charAt('replace('.length);
        const closeQuote = source.charAt(source.length - 2);
        const body = source.slice('replace('.length + 1, -2);
        const [rawSearch, replacement, extra] = body.split(new RegExp(`${openQuote}\\s*,\\s*${closeQuote}`));
        if (extra !== undefined || !rawSearch || replacement === undefined) return (value) => (typeof value === 'string' ? value : undefined);
        const variableKey = rawSearch.startsWith('{') && rawSearch.endsWith('}') ? rawSearch.slice(1, -1) : undefined;
        const replacementText = substituteTools(replacement);
        return (value, parseValue, ctx) => {
          if (typeof value !== 'string') return undefined;
          if (!variableKey) return replaceAll(value, rawSearch, replacementText);
          const resolved = ctx.resolveVariable(variableKey, parseValue);
          if (!resolved) return value;
          return replaceAll(value, resolved, replacementText);
        };
      }
      case 'remove': {
        const args = quotedArguments(inner);
        if (args.length === 0) return () => undefined;
        const targets = args.filter(Boolean);
        return (value) => {
          if (typeof value === 'string') { let result = value; for (const t of targets) result = result.replaceAll(t, ''); return result; }
          if (Array.isArray(value)) return value.filter((v) => !args.includes(v));
          return undefined;
        };
      }
      case 'join': {
        const raw = unquote(inner);
        if (raw === undefined) return undefined;
        const separator = substituteTools(raw);
        return (value) => (Array.isArray(value) ? value.join(separator) : undefined);
      }
      case 'truncate': {
        const limit = parseInt(inner, 10);
        if (isNaN(limit) || limit < 0) return undefined;
        return (value) => {
          if (typeof value !== 'string') return undefined;
          const graphemes = [...value];
          if (graphemes.length <= limit) return value;
          return graphemes.slice(0, limit).join('').replace(/\s+$/, '') + '…';
        };
      }
      case 'slice': {
        const parts = inner.split(',').map((p) => parseInt(p.trim(), 10));
        if (isNaN(parts[0])) return undefined;
        const [start, end] = [parts[0], parts.length > 1 && !isNaN(parts[1]) ? parts[1] : undefined];
        return (value) => (Array.isArray(value) ? value.slice(start, end) : undefined);
      }
      case 'default': {
        const fallback = unquote(inner);
        if (fallback === undefined) return undefined;
        return (value) => (exact.exists(value) ? value : fallback);
      }
      case 'translate': {
        const [from, to] = quotedArguments(inner);
        if (from === undefined || to === undefined) return undefined;
        return (value) => (typeof value === 'string' ? mapChars(value, from, to) : undefined);
      }
      case 'in': {
        const options = quotedArguments(inner).map((o) => o.toLowerCase());
        if (options.length === 0) return undefined;
        const set = new Set(options);
        return (value) => {
          if (value === null || value === undefined) return false;
          if (Array.isArray(value)) return value.some((item) => typeof item === 'string' && set.has(item.toLowerCase()));
          return set.has(String(value).toLowerCase());
        };
      }
      case 'time': {
        const pattern = unquote(inner);
        if (pattern === undefined) return undefined;
        return (value) => (typeof value === 'number' ? formatDurationPattern(normaliseDuration(value), pattern) : undefined);
      }
      case 'date': {
        const pattern = unquote(inner);
        if (pattern === undefined) return undefined;
        return (value) => (typeof value === 'string' ? formatDatePattern(value, pattern) : undefined);
      }
      default:
        return undefined;
    }
  }

  function compilePlain(lower) {
    return (value) => {
      if (typeof value === 'string') { const fn = stringModifiers[lower]; return fn ? fn(value) : undefined; }
      if (Array.isArray(value)) { const fn = arrayModifiers[lower]; return fn ? fn(value) : undefined; }
      if (typeof value === 'number') { const fn = numberModifiers[lower]; return fn ? fn(value) : undefined; }
      if (typeof value === 'boolean') { const fn = booleanModifiers[lower]; return fn ? fn(value) : undefined; }
      return undefined;
    };
  }

  function compileModifier(source) {
    const lower = source.toLowerCase();
    return compileConditional(lower) ?? compileParameterised(source, lower) ?? compilePlain(lower);
  }

  // ── comparators ────────────────────────────────────────────────────────────
  const comparatorFunctions = {
    and: (a, b) => a && b,
    or: (a, b) => a || b,
    xor: (a, b) => (a || b) && !(a && b),
    neq: (a, b) => a !== b,
    equal: (a, b) => a === b,
    left: (a) => a,
    right: (_, b) => b,
  };
  const comparatorNames = Object.keys(comparatorFunctions);

  // ── parser ─────────────────────────────────────────────────────────────────
  function isIdentifierChar(char) { return char !== undefined && /[A-Za-z0-9_]/.test(char); }
  class Scanner {
    constructor(input, pos = 0) { this.input = input; this.pos = pos; }
    get atEnd() { return this.pos >= this.input.length; }
    peek(offset = 0) { return this.input[this.pos + offset]; }
    eat(literal) {
      const slice = this.input.substr(this.pos, literal.length);
      if (slice.toLowerCase() !== literal.toLowerCase()) return false;
      this.pos += literal.length; return true;
    }
    startsWith(literal) {
      return this.input.substr(this.pos, literal.length).toLowerCase() === literal.toLowerCase();
    }
    slice(from, to = this.pos) { return this.input.slice(from, to); }
  }
  function scanPrefixArgument(scanner) {
    while (!scanner.atEnd) {
      const char = scanner.peek();
      if (char === '}' || char === '[' || char === ']') break;
      if (char === ':' && scanner.peek(1) === ':') break;
      scanner.pos += 1;
    }
  }
  function scanQuotedArgument(scanner) {
    const quote = scanner.peek();
    if (quote !== "'" && quote !== '"') return false;
    scanner.pos += 1;
    while (!scanner.atEnd) {
      if (scanner.peek() === quote) {
        const after = scanner.peek(1);
        if (after === undefined || after === ',' || after === ')' || /\s/.test(after)) { scanner.pos += 1; return true; }
      }
      scanner.pos += 1;
    }
    return false;
  }
  function scanDigits(scanner) {
    const start = scanner.pos;
    while (scanner.peek() !== undefined && /\d/.test(scanner.peek())) scanner.pos += 1;
    return scanner.pos > start;
  }
  function skipSpaces(scanner) { while (scanner.peek() !== undefined && /\s/.test(scanner.peek())) scanner.pos += 1; }
  function scanLooseArgument(scanner) {
    let lastParen = -1;
    while (!scanner.atEnd) {
      const char = scanner.peek();
      if (char === '}' || char === '[' || char === ']') break;
      if (char === ':' && scanner.peek(1) === ':') break;
      if (char === ')') lastParen = scanner.pos;
      scanner.pos += 1;
    }
    if (lastParen === -1) return false;
    scanner.pos = lastParen;
    return true;
  }
  function scanCallArguments(scanner, shape) {
    if (!scanner.eat('(')) return false;
    switch (shape) {
      case 'quoted': if (!scanQuotedArgument(scanner)) return false; break;
      case 'quotedPair':
        if (!scanQuotedArgument(scanner)) return false;
        skipSpaces(scanner); if (!scanner.eat(',')) return false;
        skipSpaces(scanner); if (!scanQuotedArgument(scanner)) return false;
        break;
      case 'replaceArgs':
        if (scanner.peek() === '{') { while (!scanner.atEnd && scanner.peek() !== '}') scanner.pos += 1; if (!scanner.eat('}')) return false; }
        else if (!scanQuotedArgument(scanner)) return false;
        skipSpaces(scanner); if (!scanner.eat(',')) return false;
        skipSpaces(scanner); if (!scanQuotedArgument(scanner)) return false;
        break;
      case 'digits': if (!scanDigits(scanner)) return false; break;
      case 'digitsOrPair':
        skipSpaces(scanner); if (!scanDigits(scanner)) return false;
        skipSpaces(scanner); if (scanner.eat(',')) { skipSpaces(scanner); if (!scanDigits(scanner)) return false; skipSpaces(scanner); }
        break;
      case 'loose': return scanLooseArgument(scanner) && scanner.eat(')');
    }
    return scanner.eat(')');
  }
  function parseModifier(scanner) {
    const start = scanner.pos;
    for (const [name, shape] of CALL_MODIFIERS) {
      if (!scanner.startsWith(`${name}(`)) continue;
      scanner.pos += name.length;
      if (scanCallArguments(scanner, shape)) return scanner.slice(start);
      scanner.pos = start;
      break;
    }
    for (const operator of prefixOperators) {
      if (scanner.startsWith(operator)) { scanner.pos += operator.length; scanPrefixArgument(scanner); return scanner.slice(start); }
    }
    for (const name of plainModifierNames) {
      if (!scanner.startsWith(name)) continue;
      if (isIdentifierChar(scanner.peek(name.length))) continue;
      scanner.pos += name.length;
      return scanner.slice(start);
    }
    scanner.pos = start;
    return undefined;
  }
  function parseOperandHead(scanner) {
    const start = scanner.pos;
    while (isIdentifierChar(scanner.peek())) scanner.pos += 1;
    const section = scanner.slice(start);
    if (!section || scanner.peek() !== '.') { scanner.pos = start; return undefined; }
    scanner.pos += 1;
    const propertyStart = scanner.pos;
    while (isIdentifierChar(scanner.peek())) scanner.pos += 1;
    const property = scanner.slice(propertyStart);
    if (!property) { scanner.pos = start; return undefined; }
    return { section, property };
  }
  function parseOperand(scanner) {
    let head;
    if (scanner.peek() === "'" || scanner.peek() === '"') {
      const quote = scanner.peek();
      const start = scanner.pos;
      scanner.pos += 1;
      const from = scanner.pos;
      while (!scanner.atEnd && scanner.peek() !== quote) scanner.pos += 1;
      if (scanner.atEnd) { scanner.pos = start; return undefined; }
      const literal = scanner.slice(from);
      scanner.pos += 1;
      head = { section: '', property: '', literal };
    } else {
      head = parseOperandHead(scanner);
    }
    if (!head) return undefined;
    const modifiers = [];
    while (scanner.startsWith('::')) {
      const save = scanner.pos;
      scanner.pos += 2;
      if (comparatorNames.some((c) => scanner.startsWith(`${c}::`))) { scanner.pos = save; break; }
      const modifier = parseModifier(scanner);
      if (modifier === undefined) { scanner.pos = save; break; }
      modifiers.push(modifier);
    }
    return { ...head, modifiers };
  }
  function parseCheck(scanner) {
    const start = scanner.pos;
    const fail = () => { scanner.pos = start; return undefined; };
    if (!scanner.eat('[')) return fail();
    const branch = () => {
      if (!scanner.eat('"')) return undefined;
      let text = ''; let depth = 0;
      while (!scanner.atEnd) {
        const char = scanner.peek();
        if (char === '\\' && scanner.peek(1) === '"') { text += '"'; scanner.pos += 2; continue; }
        if (char === '{') depth += 1;
        else if (char === '}') depth = Math.max(0, depth - 1);
        else if (char === '"' && depth === 0) { scanner.pos += 1; return text; }
        text += char;
        scanner.pos += 1;
      }
      return undefined;
    };
    const trueTemplate = branch();
    if (trueTemplate === undefined) return fail();
    if (!scanner.eat('||')) return fail();
    const falseTemplate = branch();
    if (falseTemplate === undefined) return fail();
    let absentTemplate;
    if (scanner.startsWith('||')) {
      scanner.pos += 2;
      absentTemplate = branch();
      if (absentTemplate === undefined) return fail();
    }
    if (!scanner.eat(']')) return fail();
    return { trueTemplate, falseTemplate, ...(absentTemplate !== undefined ? { absentTemplate } : {}) };
  }
  function parseGroupBody(scanner) {
    const start = scanner.pos;
    if (!scanner.eat('{?')) return undefined;
    const from = scanner.pos;
    let depth = 1;
    while (!scanner.atEnd) {
      if (scanner.startsWith('{?')) { depth += 1; scanner.pos += 2; continue; }
      if (scanner.startsWith('?}')) {
        depth -= 1;
        if (depth === 0) { const body = scanner.slice(from); scanner.pos += 2; return body; }
        scanner.pos += 2; continue;
      }
      scanner.pos += 1;
    }
    scanner.pos = start;
    return undefined;
  }
  function parseTool(scanner) {
    const start = scanner.pos;
    for (const tool of ['newLine', 'removeLine']) {
      if (scanner.eat(`{tools.${tool}}`)) return { kind: 'tool', tool };
      scanner.pos = start;
    }
    return undefined;
  }
  function parseExpression(scanner) {
    const start = scanner.pos;
    const fail = () => { scanner.pos = start; return undefined; };
    if (!scanner.eat('{')) return fail();
    skipSpaces(scanner);
    const operands = [];
    const found = [];
    const first = parseOperand(scanner);
    if (!first) return fail();
    operands.push(first);
    while (scanner.startsWith('::')) {
      const save = scanner.pos;
      scanner.pos += 2;
      const comparator = comparatorNames.find((name) => scanner.startsWith(`${name}::`));
      if (!comparator) { scanner.pos = save; break; }
      scanner.pos += comparator.length + 2;
      const operand = parseOperand(scanner);
      if (!operand) return fail();
      found.push(comparator.toLowerCase());
      operands.push(operand);
    }
    const check = scanner.peek() === '[' ? parseCheck(scanner) : undefined;
    skipSpaces(scanner);
    if (!scanner.eat('}')) return fail();
    return { kind: 'expression', operands, comparators: found, ...(check ? { check } : {}) };
  }
  function parseTemplate(template) {
    const scanner = new Scanner(template);
    const nodes = [];
    let literalStart = 0;
    const flushLiteral = (end) => { if (end > literalStart) nodes.push({ kind: 'raw', text: template.slice(literalStart, end) }); };
    while (!scanner.atEnd) {
      if (scanner.peek() !== '{') { scanner.pos += 1; continue; }
      const braceIndex = scanner.pos;
      if (scanner.startsWith('{?')) {
        const body = parseGroupBody(scanner);
        if (body !== undefined) {
          flushLiteral(braceIndex);
          nodes.push({ kind: 'group', nodes: parseTemplate(body).nodes });
          literalStart = scanner.pos;
          continue;
        }
      }
      const node = parseTool(scanner) ?? parseExpression(scanner);
      if (!node) { scanner.pos = braceIndex + 1; continue; }
      flushLiteral(braceIndex);
      nodes.push(node);
      literalStart = scanner.pos;
    }
    flushLiteral(template.length);
    return { nodes };
  }

  // ── compile ────────────────────────────────────────────────────────────────
  function isPresent(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return /\S/.test(value);
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }
  function prepareOperand(node) {
    return { node, modifiers: node.modifiers.map((source) => ({ source, apply: compileModifier(source) })) };
  }
  function resolveOperand(operand, parseValue) {
    if (operand.node.literal !== undefined) {
      const ctx = { resolveVariable: (source) => resolveField(parseValue, source) };
      let value = operand.node.literal;
      for (const { apply } of operand.modifiers) {
        const next = apply(value, parseValue, ctx);
        if (next === undefined) break;
        value = next;
        if (typeof value === 'string' && value.length > MAX_RENDER_LENGTH) { value = value.slice(0, MAX_RENDER_LENGTH); break; }
      }
      return { result: value, present: true };
    }
    const section = parseValue[operand.node.section];
    const property = section ? section[operand.node.property] : undefined;
    if (property === undefined) {
      return { result: '', present: false };
    }
    const ctx = { resolveVariable: (source) => resolveField(parseValue, source) };
    let result = typeof property === 'string' ? sanitise(property) : property;
    const present = isPresent(property) || operand.modifiers.some(({ source }) => source.toLowerCase().startsWith('default('));
    for (const { source, apply } of operand.modifiers) {
      const input = result;
      result = apply(input, parseValue, ctx);
      if (result !== undefined) {
        if (typeof result === 'string' && result.length > MAX_RENDER_LENGTH) { result = result.slice(0, MAX_RENDER_LENGTH); break; }
        continue;
      }
      if (input === null || input === undefined) return { result: '', present };
      return { result: '', present };
    }
    return { result, present };
  }
  function resolveField(parseValue, path) {
    const [section, property] = String(path || '').split('.');
    if (!section || !property) return undefined;
    const value = parseValue[section] ? parseValue[section][property] : undefined;
    return value === undefined || value === null ? undefined : String(value);
  }
  function operandPresence(operand, parseValue) {
    if (operand.node.literal !== undefined) return true;
    if (operand.modifiers.some(({ source }) => source.toLowerCase().startsWith('default('))) return true;
    const section = parseValue[operand.node.section];
    return section ? isPresent(section[operand.node.property]) : false;
  }
  function resolveExpression(node, operands, parseValue) {
    if (operands.length === 1) return resolveOperand(operands[0], parseValue);
    let present = operandPresence(operands[0], parseValue);
    for (let i = 1; i < operands.length; i++) {
      const next = operandPresence(operands[i], parseValue);
      present = node.comparators[i - 1] === 'or' ? present || next : present && next;
    }
    const allSame = node.comparators.every((c) => c === node.comparators[0]);
    const canShortCircuit = allSame && (node.comparators[0] === 'and' || node.comparators[0] === 'or');
    let result = resolveOperand(operands[0], parseValue);
    for (let i = 1; i < operands.length; i++) {
      const comparator = node.comparators[i - 1];
      if (canShortCircuit) {
        if (comparator === 'and' && result.result === false) return { result: false, present };
        if (comparator === 'or' && result.result === true) return { result: true, present };
      }
      const next = resolveOperand(operands[i], parseValue);
      try { result = { result: comparatorFunctions[comparator](result.result, next.result) }; }
      catch { result = { result: false }; }
    }
    return { result: result.result, present };
  }
  function compileNode(node, depth) {
    if (depth > 5) return () => '';
    if (node.kind === 'raw') {
      const text = node.text.replace(/\\n/g, '\n');
      return () => text;
    }
    if (node.kind === 'tool') {
      const sentinel = node.tool === 'newLine' ? NEW_LINE_SENTINEL : REMOVE_LINE_SENTINEL;
      return () => sentinel;
    }
    if (node.kind === 'group') return compileGroup(node, depth);
    const operands = node.operands.map(prepareOperand);
    if (!node.check) {
      return (parseValue) => {
        const resolved = resolveExpression(node, operands, parseValue);
        return String(resolved.result ?? '');
      };
    }
    const whenTrue = compileTemplate(node.check.trueTemplate, depth + 1);
    const whenFalse = compileTemplate(node.check.falseTemplate, depth + 1);
    const whenAbsent = node.check.absentTemplate === undefined ? undefined : compileTemplate(node.check.absentTemplate, depth + 1);
    return (parseValue) => {
      const resolved = resolveExpression(node, operands, parseValue);
      if (!isPresent(resolved.result)) return whenAbsent ? whenAbsent(parseValue) : '';
      if (resolved.result !== true && resolved.result !== false) return '';
      return resolved.result ? whenTrue(parseValue) : whenFalse(parseValue);
    };
  }
  function compileGroup(node, depth) {
    const parts = node.nodes.map((child) => ({
      node: child,
      render: compileNode(child, depth),
      operands: child.kind === 'expression' && !child.check ? child.operands.map(prepareOperand) : undefined,
    }));
    return (parseValue) => {
      let out = '';
      for (const { node: child, render, operands } of parts) {
        if (operands) {
          const resolved = resolveExpression(child, operands, parseValue);
          if (resolved.present === false) return '';
        }
        out += render(parseValue);
      }
      return out;
    };
  }
  function compileTemplate(template, depth = 0) {
    if (depth > 5) return () => '';
    const { nodes } = parseTemplate(template);
    const compiled = nodes.map((node) => compileNode(node, depth));
    return (parseValue) => {
      let out = '';
      for (const part of compiled) out += part(parseValue);
      return out;
    };
  }

  /** Render a template then run the layout post-pass (drop blank/removeLine lines). */
  function render(template, parseValue) {
    return compileTemplate(template)(parseValue)
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes(REMOVE_LINE_SENTINEL))
      .join('\n')
      .replaceAll(NEW_LINE_SENTINEL, '\n');
  }

  // ── presets (from AIOStreams formatter-definitions.ts) ─────────────────────
  const presets = {
    torrentio: {
      name: '{stream.proxied::istrue["🕵️‍♂️ "||""]}{stream.private::istrue["🔑 "||""]}{stream.type::=p2p["[P2P] "||""]}{service.id::exists["[{service.shortName}"||""]}{service.cached::istrue["+] "||""]}{service.cached::isfalse[" download] "||""]}{addon.name} {stream.resolution::exists["{stream.resolution}"||"Unknown"]}\n{?{stream.visualTags::join(" | ")}?}',
      description: '{?ℹ️{stream.message}?}\n{?{stream.folderName}?}\n{?{stream.filename}?}\n{stream.size::>0["💾{stream.size::bytes2} "||""]}{stream.folderSize::>0["/ 💾{stream.folderSize::bytes2}"||""]}{stream.seeders::>=0["👤{stream.seeders} "||""]}{?📅{stream.age} ?}{?⚙️{stream.indexer}?}\n{?{stream.languageEmojis::join(" / ")}?}{stream.subtitles::exists::and::stream.languageEmojis::exists[" "||""]}{stream.subtitles::exists["Subs / {stream.subtitleEmojis::join(" / ")}"||""]}\n',
    },
    torbox: {
      name: '{stream.proxied::istrue["🕵️‍♂️ "||""]}{stream.private::istrue["🔑 "||""]}{stream.type::=p2p["[P2P] "||""]}{addon.name}{stream.library::istrue[" (Your Media) "||""]}{service.cached::istrue[" (Instant "||""]}{service.cached::isfalse[" ("||""]}{service.id::exists["{service.shortName})"||""]}{? ({stream.resolution})?}',
      description: 'Quality: {stream.quality::exists["{stream.quality}"||"Unknown"]}\nName: {stream.filename::exists["{stream.filename}"||"Unknown"]}\nSize: {stream.size::>0["{stream.size::bytes} "||""]}{stream.folderSize::>0["/ {stream.folderSize::bytes} "||""]}{?| Source: {stream.indexer} ?}{stream.duration::>0["| Duration: {stream.duration::time} "||""]}\nLanguages: {?{stream.languages::join(", ")}?}{stream.subtitles::exists::and::stream.languages::exists[" | "||""]}{?Subtitles: {stream.subtitles::join(", ")}?}\n{?Message: {stream.message}?}',
    },
    gdrive: {
      name: '{stream.proxied::istrue["🕵️ "||""]}{stream.private::istrue["🔑 "||""]}{stream.type::=p2p["[P2P] "||""]}{?[{service.shortName}?}{service.cached::istrue["⚡] "||""]}{service.cached::isfalse["⏳] "||""]}{addon.name}{stream.library::istrue[" (Your Media)"||""]} {?{stream.resolution}?}{stream.seadexBest::istrue[" (Best)"||""]}{stream.seadex::istrue::and::stream.seadexBest::isfalse[" (SeaDex Alt.)"||""]}{stream.rseMatched::exists::and::stream.seadex::isfalse::and::stream.rseMatched::string::~T1::or::stream.rseMatched::string::~T2::or::stream.rseMatched::string::~T3::or::stream.rseMatched::string::~T4::or::stream.rseMatched::string::~T5::or::stream.rseMatched::string::~T6::or::stream.rseMatched::string::~T7::or::stream.rseMatched::string::~T8[" ({stream.rseMatched::first})"||""]}{stream.regexMatched::exists::and::stream.rseMatched::exists::isfalse::and::stream.seadex::isfalse[" ({stream.regexMatched})"||""]}',
      description: '{?🎥 {stream.quality} ?}{?🎞️ {stream.encode} ?}{?🏷️ {stream.releaseGroup} ?}{?📡 {stream.network} ?}\n{?📺 {stream.visualTags::join(" | ")} ?}{?🎧 {stream.audioTags::join(" | ")} ?}{?🔊 {stream.audioChannels::join(" | ")}?}\n{stream.size::>0["📦 {stream.size::sbytes} "||""]}{stream.folderSize::>0["/ {stream.folderSize::sbytes} "||""]}{stream.bitrate::>0["({stream.bitrate::sbitrate})"||""]}{stream.duration::>0["⏱️ {stream.duration::time} "||""]}{stream.seeders::>0["👥 {stream.seeders} "||""]}{?📅 {stream.age} ?}{?🔍 {stream.indexer}?}\n{?🌎 {stream.languages::join(" | ")}?}{?📝 {stream.subtitles::join(" | ")}?}\n{stream.filename::exists["📁"||""]} {?{stream.folderName}/?}{?{stream.filename}?}\n{?ℹ️ {stream.message}?}\n',
    },
    lightgdrive: {
      name: '{stream.proxied::istrue["🕵️ "||""]}{stream.private::istrue["🔑 "||""]}{stream.type::=p2p["[P2P] "||""]}{?[{service.shortName}?}{stream.library::istrue["☁️"||""]}{service.cached::istrue["⚡] "||""]}{service.cached::isfalse["⏳] "||""]}{addon.name}{? {stream.resolution}?}{stream.seadexBest::istrue[" (Best)"||""]}{stream.seadex::istrue::and::stream.seadexBest::isfalse[" (SeaDex Alt.)"||""]}{stream.rseMatched::exists::and::stream.seadex::isfalse::and::stream.rseMatched::string::~T1::or::stream.rseMatched::string::~T2::or::stream.rseMatched::string::~T3::or::stream.rseMatched::string::~T4::or::stream.rseMatched::string::~T5::or::stream.rseMatched::string::~T6::or::stream.rseMatched::string::~T7::or::stream.rseMatched::string::~T8[" ({stream.rseMatched::first})"||""]}{stream.regexMatched::exists::and::stream.rseMatched::exists::isfalse::and::stream.seadex::isfalse[" ({stream.regexMatched})"||""]}',
      description: '{?📁 {stream.title::title}?}{? ({stream.year})?}{? {stream.seasonEpisode::join(" • ")}?}\n{?🎥 {stream.quality} ?}{?🎞️ {stream.encode} ?}{?🏷️ {stream.releaseGroup}?}{?📡 {stream.network} ?}\n{?📺 {stream.visualTags::join(" • ")} ?}{?🎧 {stream.audioTags::join(" • ")} ?}{?🔊 {stream.audioChannels::join(" • ")}?}\n{stream.size::>0["📦 {stream.size::sbytes} "||""]}{stream.folderSize::>0["/ {stream.folderSize::sbytes} "||""]}{stream.duration::>0["⏱️ {stream.duration::time} "||""]}{?📅 {stream.age} ?}{?🔍 {stream.indexer}?}\n{?🌐 {stream.languageEmojis::join(" / ")}?}{stream.subtitles::exists["📝 {stream.subtitleEmojis::join(" / ")}"||""]}\n{?ℹ️ {stream.message}?}',
    },
    minimalisticgdrive: {
      name: '{stream.resolution::exists["{stream.resolution::replace("2160p","✨ 4K")::replace("1440p","📀 2K")::replace("1080p","🧿1080p")::replace("720p","💿720p")}"||"N/A"]}{service.cached::istrue[" 🎫 "||""]}{service.cached::isfalse[" 🎟️ "||""]}\n{?{stream.quality::upper}?}\n',
      description: '{?🔆 {stream.visualTags::join(" • ")}  ?}{?🔊 {stream.audioTags::join(" • ")}?}\n{stream.size::>0["📦 {stream.size::sbytes} "||""]}\n{?🌎 {stream.languages::join(" • ")}?}{?📝 {stream.subtitles::join(" • ")}?}\n',
    },
    prism: {
      name: '{stream.resolution::exists["{stream.resolution::replace("2160p", "🔥4K UHD")::replace("1440p","✨ QHD")::replace("1080p","🚀 FHD")::replace("720p","💿 HD")::replace("576p","💩 Low Quality")::replace("480p","💩 Low Quality")::replace("360p","💩 Low Quality")::replace("240p","💩 Low Quality")::replace("144p","💩 Low Quality")}"||"💩 Unknown"]}',
      description: '{?🎬 {stream.title::title} ?}{?({stream.year}) ?}{?🍂 {stream.formattedSeasons} ?}{?🎞️ {stream.formattedEpisodes}?}{stream.seadexBest::istrue["🎚️ Best "||""]}{stream.seadex::istrue::and::stream.seadexBest::isfalse["🎚️ Alternative"||""]}{stream.rseMatched::exists::and::stream.seadex::isfalse::and::stream.rseMatched::string::~T1::or::stream.rseMatched::string::~T2::or::stream.rseMatched::string::~T3::or::stream.rseMatched::string::~T4::or::stream.rseMatched::string::~T5::or::stream.rseMatched::string::~T6::or::stream.rseMatched::string::~T7::or::stream.rseMatched::string::~T8[" 🎚️ {stream.rseMatched::first}"||""]}{stream.regexMatched::exists::and::stream.rseMatched::exists::isfalse::and::stream.seadex::isfalse["🎚️ {stream.regexMatched} "||""]}\n{?🎥 {stream.quality} ?}{?📺 {stream.visualTags::join(" | ")} ?}{?🎞️ {stream.encode} ?}{stream.duration::>0["⏱️ {stream.duration::time} "||""]}\n{?🎧 {stream.audioTags::join(" | ")} ?}{?🔊 {stream.audioChannels::join(" | ")} ?}{stream.languages::exists["🗣️ {stream.languageEmojis::join(" / ")}"||""]}{stream.subtitles::exists["📝 {stream.subtitleEmojis::join(" / ")}"||""]}\n{stream.size::>0["📦 {stream.size::sbytes} "||""]}{stream.folderSize::>0["/ {stream.folderSize::sbytes} "||""]}{stream.bitrate::>0["📊 {stream.bitrate::sbitrate} "||""]}{service.cached::isfalse::or::stream.type::=p2p::and::stream.seeders::>0["🌱 {stream.seeders} "||""]}{stream.type::=usenet::and::stream.age::exists["📅 {stream.age} "||""]}\n{?🏷️ {stream.releaseGroup} ?}{?📡 {stream.indexer} ?}{?🎭 {stream.network}?}\n{service.cached::istrue["⚡Ready "||""]}{service.cached::isfalse["❌ Not Ready "||""]}{service.id::exists["({service.shortName}) "||""]}{stream.library::istrue["📌 Library "||""]}{stream.type::=Usenet["📰 Usenet "||""]}{stream.type::=p2p["⚠️ P2P "||""]}{stream.type::=http["💻 Web Link "||""]}{stream.type::=youtube["▶️ Youtube "||""]}{stream.type::=live["📺 Live "||""]}{stream.proxied::istrue["🔒 Proxied "||""]}{stream.private::istrue["🔑 Private "||""]}🔍{addon.name}\n{?ℹ️ {stream.message}?}\n',
    },
    tamtaro: {
      name: '{stream.resolution::exists["{stream.resolution::replace("2160p","  4K  ")::replace("1440p","  2K  ")::replace("1080p","1080p ")::replace("720p"," 720p ")}"||""]}{service.cached["⚡"||"⏳"||""]}\n{stream.source::exists::or::stream.visualTags::exists["〈 "||""]}{stream.source::exists["{stream.source}"||""]}{stream.visualTags::exists["{stream.source::exists[" · "||""]}{stream.visualTags::join(" · ")}"||""]}{stream.source::exists::or::stream.visualTags::exists[" 〉"||""]}',
      description: '{?▣ {stream.encode}{stream.visualTags::exists["  {stream.visualTags::join(" · ")}"||""]}?}\n{?♬ {stream.audioTags::join(" · ")}{stream.audioTags::exists::and::stream.audioChannels::exists["  ♯ "||""]}{stream.audioChannels::join(" · ")}?}\n{?◈ {stream.size::sbytes}{stream.releaseGroup::exists[" · {stream.releaseGroup}"||""]}?}\n{?⛉ [{service.shortName}] {addon.name}?}\n{stream.languages::exists["✓ {stream.languages::join(" · ")}"||""]}{stream.languages::exists::and::stream.subtitles::exists[" · "||""]}{stream.subtitles::exists["⛿ {stream.subtitles::join(" · ")}"||""]}',
    },
    lelibrary: {
      name: '{addon.badgeName}\n{stream.resolution::exists["{stream.resolution::replace("2160p","4K")}"||""]}{stream.resolution::exists::and::stream.visualTags::exists[" · "||""]}{stream.visualTags::exists["{stream.visualTags::join(" · ")}"||""]}',
      description: '⚡ {addon.name}\n{?🎬 {stream.source} · {stream.releaseTags::join(" · ")} · {stream.encode}?}\n{?🔊 {stream.audioTags::join(" · ")} · {stream.audioChannels::join(" · ")}?}\n{stream.languages::exists["🌐 {stream.languages::join(", ")}"||""]}{stream.languages::exists::and::stream.subtitles::exists[" · "||""]}{stream.subtitles::exists["💬 {stream.subtitles::join(", ")}"||""]}\n{stream.size::>0["💾 {stream.size::sbytes}"||""]}{stream.size::>0::and::stream.releaseGroup::exists[" · "||""]}{stream.releaseGroup::exists["🏷️ {stream.releaseGroup}"||""]}',
    },
    cinema: {
      name: '🎬 {stream.resolution::exists["{stream.resolution::replace("2160p","4K UHD")::replace("1080p","1080p FHD")::replace("720p","720p HD")}"||"Stream"]}{stream.releaseTags::exists[" · {stream.releaseTags::join(" · ")}"||""]}{service.cached::istrue[" · ⚡"||""]}',
      description: '{?🎞️ {stream.source} · {stream.encode} ?}\n{?🎧 {stream.audioTags::join(" · ")} · {stream.audioChannels::join(" · ")}?}\n{stream.visualTags::exists["✨ {stream.visualTags::join(" · ")}\n"||""]}{stream.size::>0["📦 SIZE {stream.size::sbytes}"||""]}{stream.releaseGroup::exists[" · {stream.releaseGroup}"||""]}',
    },
    remux: {
      name: '💎 {stream.resolution::exists["{stream.resolution::replace("2160p","4K")}"||"HD"]}{stream.releaseTags::exists[" · {stream.releaseTags::join(" · ")}"||""]}{service.cached::istrue[" · CACHED"||""]}',
      description: '{?🎞️ {stream.source} · {stream.encode}?}\n{?🔊 {stream.audioTags::join(" · ")} · {stream.audioChannels::join(" · ")}?}\n{stream.visualTags::exists["🌈 {stream.visualTags::join(" · ")}\n"||""]}{stream.size::>0["📦 {stream.size::sbytes}"||""]}{stream.releaseGroup::exists[" · 🏷️ {stream.releaseGroup}"||""]}',
    },
    compact: {
      name: '{addon.badgeName} · {stream.resolution::exists["{stream.resolution::replace("2160p","4K")}"||"HD"]}{stream.releaseTags::exists[" · {stream.releaseTags::first}"||""]}',
      description: '{?{stream.source} · {stream.encode} · {stream.visualTags::join(" · ")}?}\n{?{stream.audioTags::join(" · ")} · {stream.audioChannels::join(" · ")}?}{stream.size::>0["\n📦 {stream.size::sbytes}"||""]}',
    },
    technical: {
      name: '⚡ {addon.badgeName} · {stream.resolution::exists["{stream.resolution}"||"Unknown"]}{stream.releaseTags::exists[" · {stream.releaseTags::join(" · ")}"||""]}',
      description: '{?SOURCE  {stream.source}?}{stream.encode::exists[" · CODEC  {stream.encode}"||""]}\n{stream.visualTags::exists["VIDEO  {stream.visualTags::join(" · ")}\n"||""]}{stream.audioTags::exists["AUDIO  {stream.audioTags::join(" · ")}"||""]}{stream.audioChannels::exists[" · {stream.audioChannels::join(" · ")}"||""]}\n{stream.size::>0["SIZE  {stream.size::sbytes}"||""]}{stream.releaseGroup::exists[" · GROUP  {stream.releaseGroup}"||""]}\n{stream.filename::exists["📁 {stream.filename}"||""]}',
    },
  };

  // ── LeLibrary context builder ──────────────────────────────────────────────
  const QUALITY_RESOLUTION = { '2160p': '4K', '1080p': '1080p', '720p': '720p', '576p': '576p', '480p': '480p' };
  function parseQuality(filename) {
    const u = String(filename || '').toUpperCase();
    if (u.match(/\b(2160P|4K|UHD)\b/)) return { resolution: '2160p', quality: '4K' };
    if (u.match(/\b1080P\b/)) return { resolution: '1080p', quality: '1080p' };
    if (u.match(/\b720P\b/)) return { resolution: '720p', quality: '720p' };
    if (u.match(/\b576P\b/)) return { resolution: '576p', quality: '576p' };
    if (u.match(/\b480P\b/)) return { resolution: '480p', quality: '480p' };
    return { resolution: '', quality: '' };
  }
  function parseVisualTags(filename) {
    const u = String(filename || '').toUpperCase();
    const tags = [];
    if (u.match(/DOLBY.?VISION|\bDV\b/)) tags.push('DV');
    if (u.match(/HDR10(\+|PLUS)/)) tags.push('HDR10+');
    else if (u.match(/\bHDR10\b/)) tags.push('HDR10');
    else if (u.match(/\bHDR\b/)) tags.push('HDR');
    if (u.match(/\b10.?BIT\b/)) tags.push('10bit');
    return tags;
  }
  function parseEncode(filename) {
    const u = String(filename || '').toUpperCase();
    if (u.match(/\bH\.?265\b|\bHEVC\b|\bX265\b/)) return 'HEVC';
    if (u.match(/\bH\.?264\b|\bAVC\b|\bX264\b/)) return 'AVC';
    if (u.match(/\bAV1\b/)) return 'AV1';
    return '';
  }
  function parseSource(filename) {
    const u = String(filename || '').toUpperCase();
    if (u.match(/\bBLURAY\b|\bBLU\.RAY\b|\bBDRIP\b/)) return 'BluRay';
    if (u.match(/\bWEB[-.]?DL\b|\bWEB[-.]?DLRIP\b/)) return 'WEB-DL';
    if (u.match(/\bWEB[-.]?RIP\b/)) return 'WEBRip';
    if (u.match(/\bHDTV\b/)) return 'HDTV';
    if (u.match(/\bDVDRIP\b/)) return 'DVDRip';
    return '';
  }
  function parseReleaseTags(filename) {
    const u = String(filename || '').toUpperCase();
    const tags = [];
    if (/\bREMUX\b/.test(u)) tags.push('REMUX');
    if (/\bPROPER\b/.test(u)) tags.push('PROPER');
    if (/\bREPACK\b/.test(u)) tags.push('REPACK');
    if (/\bEXTENDED\b/.test(u)) tags.push('EXTENDED');
    if (/\bIMAX\b/.test(u)) tags.push('IMAX');
    if (/\b(?:OPEN[ ._-]?MATTE|OM)\b/.test(u)) tags.push('OPEN MATTE');
    if (/\bCRITERION\b/.test(u)) tags.push('CRITERION');
    if (/\bREMASTER(?:ED)?\b/.test(u)) tags.push('REMASTERED');
    return tags;
  }
  function parseAudioTags(filename) {
    const u = String(filename || '').toUpperCase();
    const tags = [];
    if (u.match(/\bTRUEHD\b/)) tags.push('TrueHD');
    if (u.match(/\bATMOS\b/)) tags.push('Atmos');
    else if (u.match(/\bDTS.?HD\b/)) tags.push('DTS-HD');
    else if (u.match(/\bDTS\b/)) tags.push('DTS');
    else if (u.match(/\bDDP?5\.?1\b|\bDD5\.?1\b/)) tags.push('DD5.1');
    else if (u.match(/\bAAC\b/)) tags.push('AAC');
    return tags;
  }
  function parseAudioChannels(filename) {
    const u = String(filename || '').toUpperCase();
    const m = u.match(/7\.1/); if (m) return ['7.1'];
    const m2 = u.match(/5\.1/); if (m2) return ['5.1'];
    return [];
  }
  function parseReleaseGroup(filename) {
    const base = String(filename || '').replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '');
    const m = base.match(/-([A-Za-z0-9]{2,12})$/);
    return m ? m[1] : '';
  }
  function parseLanguages(filename) {
    const u = String(filename || '').toUpperCase();
    const langs = [];
    if (u.match(/\bDUAL\b|\bDUBLADO\b|\bNACIONAL\b/)) { langs.push('English'); langs.push('Portuguese'); }
    else if (u.match(/\bPT.?BR\b/)) langs.push('Portuguese');
    else if (u.match(/\bPT.?PT\b/)) langs.push('Portuguese');
    else if (u.match(/\bENG(LISH)?\b/)) langs.push('English');
    return [...new Set(langs)];
  }
  function parseSubtitles(filename) {
    const u = String(filename || '').toUpperCase();
    if (u.match(/\bMULTI.?SUB\b/)) return ['Portuguese', 'English'];
    if (u.match(/\bPLSUB\b/)) return ['Portuguese'];
    if (u.match(/\bLEGENDADO\b/) && !u.match(/\bDUAL\b/)) return ['Portuguese'];
    return [];
  }
  function isSubbed(filename) {
    const u = String(filename || '').toUpperCase();
    return /MULTI.?SUB|PLSUB|LEGENDADO/.test(u);
  }
  function isDubbed(filename) {
    const u = String(filename || '').toUpperCase();
    return /\bDUAL\b|\bDUBLADO\b|\bNACIONAL\b/.test(u);
  }

  // Stream builders can supply richer metadata through opts.metadata. When
  // they do not, infer a useful title/year pair from the filename so custom
  // {metadata.title} and {metadata.year} templates do not resolve to blanks.
  function inferMetadata(filename) {
    let base = String(filename || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const yearMatch = base.match(/(?:^|[. _-])((?:19|20)\d{2})(?=[. _-]|$)/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    if (yearMatch) base = base.slice(0, yearMatch.index);
    base = base.replace(/[._]+/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    base = base.replace(/\bS\d{1,2}(?:E\d{1,4}(?:-E?\d{1,4})?)?\b.*$/i, '');
    base = base.replace(/\b(?:2160|1440|1080|720|576|480|360|240)p\b.*$/i, '');
    base = base.replace(/\s+/g, ' ').replace(/[ -]+$/, '').trim();
    return { title: base || null, year };
  }

  function buildLeContext(filename, source, size, opts = {}) {
    const addonName = opts.addonName || 'LeLibrary';
    const fname = String(filename || '');
    const { resolution, quality } = parseQuality(fname);
    const languages = parseLanguages(fname);
    const subtitles = parseSubtitles(fname);
    const languageEmojis = languages.map(languageToEmoji).filter(Boolean);
    const subtitleEmojis = subtitles.map(languageToEmoji).filter(Boolean);
    const inferred = inferMetadata(fname);
    const suppliedMetadata = opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {};
    const metadataTitle = suppliedMetadata.title || inferred.title || null;
    const metadataYear = suppliedMetadata.year || inferred.year || null;
    const serviceMeta = {
      torbox: { id: 'torbox', shortName: 'TB', name: 'TorBox' },
      realdebrid: { id: 'realdebrid', shortName: 'RD', name: 'Real-Debrid' },
      alldebrid: { id: 'alldebrid', shortName: 'AD', name: 'AllDebrid' },
      premiumize: { id: 'premiumize', shortName: 'PM', name: 'Premiumize' },
      // External stream addons (Trending/Popular discovery rows): the badge
      // reflects the addon the stream came from, not the user's debrid provider.
      torrentio:   { id: 'torrentio',   shortName: 'TR', name: 'Torrentio' },
      comet:       { id: 'comet',       shortName: 'CM', name: 'Comet' },
      meteor:      { id: 'meteor',      shortName: 'ME', name: 'Meteor' },
      mediafusion: { id: 'mediafusion', shortName: 'MF', name: 'MediaFusion' },
    }[source] || { id: 'torbox', shortName: 'TB', name: 'TorBox' };

    const emptyLists = { languages, subtitles, languageEmojis, subtitleEmojis };
    return {
      config: { addonName: 'LeLibrary' },
      stream: {
        filename: fname,
        folderName: null,
        size: size || null,
        folderSize: null,
        quality: quality || null,
        resolution: resolution || null,
        source: parseSource(fname) || null,
        releaseTags: parseReleaseTags(fname),
        subbed: isSubbed(fname),
        dubbed: isDubbed(fname),
        ...emptyLists,
        uLanguages: languages, uSubtitles: subtitles,
        uLanguageEmojis: languageEmojis, uSubtitleEmojis: subtitleEmojis,
        languageCodes: languages.map(toLanguageCode), subtitleCodes: subtitles.map(toLanguageCode),
        smallLanguageCodes: languages.map((l) => makeSmall(toLanguageCode(l))), smallSubtitleCodes: subtitles.map((l) => makeSmall(toLanguageCode(l))),
        uLanguageCodes: languages.map(toLanguageCode), uSubtitleCodes: subtitles.map(toLanguageCode),
        uSmallLanguageCodes: languages.map((l) => makeSmall(toLanguageCode(l))), uSmallSubtitleCodes: subtitles.map((l) => makeSmall(toLanguageCode(l))),
        visualTags: parseVisualTags(fname),
        audioTags: parseAudioTags(fname),
        audioChannels: parseAudioChannels(fname),
        releaseGroup: parseReleaseGroup(fname) || null,
        encode: parseEncode(fname) || null,
        seeders: null,
        age: null,
        ageHours: null,
        type: 'debrid',
        proxied: false,
        private: false,
        freeleech: null,
        duration: null,
        bitrate: null,
        message: null,
        title: metadataTitle,
        year: metadataYear,
        date: null,
        country: null,
        network: null,
        indexer: null,
        container: null,
        extension: null,
        edition: null,
        editions: null,
        season: null,
        episode: null,
        seasons: null,
        episodes: null,
        seasonPack: false,
        formattedSeasons: null,
        formattedEpisodes: null,
        seasonEpisode: null,
        nSeScore: null,
        seScore: null,
        rseMatched: [],
        regexMatched: null,
        seadex: false,
        seadexBest: false,
        library: !!opts.library,
        preloading: false,
        idMatched: false,
      },
      metadata: {
        queryType: null, type: null, isAnime: false, title: metadataTitle, titles: null,
        year: metadataYear, yearEnd: null, runtime: null, episodeRuntime: null, genres: null,
        originalLanguage: null, country: null, season: null, episode: null,
        absoluteEpisode: null, relativeAbsoluteEpisode: null, episodeTitle: null,
        episodeTitles: null, latestSeason: null, daysSinceRelease: null,
        daysSinceFirstAired: null, daysSinceLastAired: null, hasNextEpisode: false,
        daysUntilNextEpisode: null, anilistId: null, malId: null, hasSeaDex: false,
      },
      service: { id: serviceMeta.id, shortName: serviceMeta.shortName, name: serviceMeta.name, cached: true },
      addon: { name: addonName, badgeName: `[${serviceMeta.shortName}+] ${addonName}`, presetId: null, manifestUrl: null },
    };
  }

  /** Render name + description from templates against a LeLibrary stream. */
  function formatStream(nameTpl, descTpl, filename, source, size, opts = {}) {
    const ctx = buildLeContext(filename, source, size, opts);
    return {
      name: render(nameTpl, ctx),
      description: render(descTpl, ctx),
    };
  }

  return {
    render,
    format: render,
    formatStream,
    buildLeContext,
    presets,
    compileTemplate,
  };
});
