// Local anime-candidate signals. These are cheap, offline heuristics used only
// to decide whether an entity is worth confirming against Kitsu/AniList/MAL.
// They are deliberately NOT the definition of anime: a candidate still has to
// be confirmed by a provider before it is reclassified.
//
// The parser already flags fansub groups, CJK and absolute numbering; this list
// adds well-known franchises whose plain English names would otherwise look
// like ordinary TV.
const ANIME_KEYWORDS = [
  'one piece', 'naruto', 'boruto', 'bleach', 'dragon ball', 'dbz', 'dbs',
  'attack on titan', 'shingeki no kyojin', 'demon slayer', 'kimetsu no yaiba',
  'jujutsu kaisen', 'my hero academia', 'boku no hero', 'fullmetal alchemist',
  'hunter x hunter', 'death note', 'sword art online', 'tokyo ghoul',
  'spy x family', 'chainsaw man', 'frieren', 'sousou no frieren',
  'solo leveling', 'vinland saga', 'steins gate', 'code geass', 'gintama',
  'fairy tail', 'black clover', 'seven deadly sins', 'nanatsu no taizai',
  're zero', 're:zero', 'konosuba', 'overlord', 'mob psycho', 'one punch man',
  'cowboy bebop', 'trigun', 'neon genesis', 'evangelion', 'fullmetal',
  'sailor moon', 'cardcaptor', 'inuyasha', 'ranma', 'yuyu hakusho',
  'rurouni kenshin', 'samurai champloo', 'akira', 'ghost in the shell',
  'princess mononoke', 'spirited away', 'my neighbor totoro', 'howl',
  'grave of the fireflies', 'pokemon', 'digimon', 'yu gi oh', 'yugioh',
  'doraemon', 'detective conan', 'case closed', 'gundam',
  'evangelion', 'berserk', 'hellsing', 'tokyo revengers', 'dr stone',
  'the promised neverland', 'yakusoku no neverland', 'haikyuu', 'kuroko',
  'slam dunk', 'initial d', 'food wars', 'shokugeki', 'fire force',
  'fire brigade of flames', 'blue exorcist', 'ao no exorcist', 'noragami',
  'toradora', 'clannad', 'your lie in april', 'anohana', 'violet evergarden',
  'made in abyss', 'mushoku tensei', 'that time i got reincarnated',
  'tensei shitara slime', 'shield hero', 'tate no yuusha',
  'rising of the shield hero', 'log horizon', 'no game no life',
  'monogatari', 'bakemonogatari', 'sailor moon', 'sailor moon crystal',
  'pretty cure', 'precure', 'bakugan', 'beyblade', 'kaguya-sama', 'kaguya sama',
  'horimiya', 'komi cant communicate', 'rent a girlfriend',
  'quintessential quintuplets', 'grand blue', 'nichijou', 'k-on', 'haruhi',
  'lucky star', 'psycho pass', 'parasyte', 'kiseijuu', 'erased',
  'boku dake ga inai machi', 'when they cry', 'higurashi', 'elfen lied',
  'mirai nikki', 'future diary', 'deadman wonderland', 'akame ga kill',
  'assassination classroom', 'ansatsu kyoushitsu', 'great teacher onizuka',
  'yuri on ice', 'fruits basket', 'ouran high school', 'kaichou wa maid sama',
  'yu yu hakusho', 'ronin warriors', 'saint seiya', 'captain tsubasa',
  'macross', 'robotech', 'patlabor', 'bubblegum crisis', 'vampire hunter d',
  'perfect blue', 'paprika', 'millennium actress', 'tokyo godfathers',
  'wolf children', 'the girl who leapt through time', 'weathering with you',
  'your name', 'kimi no na wa', 'a silent voice', 'koe no katachi',
  'i want to eat your pancreas', 'josee', 'goblin slayer', 'danmachi',
  'is it wrong to try to pick up girls', 'arifureta',
  'classroom of the elite', 'youkoso jitsuryoku', 'tomodachi game',
  'high school of the dead', 'highschool of the dead', 'blood lad',
  'aggretsuko', 'beastars', 'little witch academia', 'kakegurui', 'kaiji',
  'one outs', 'hajime no ippo', 'eyeshield', 'kuroko no basket',
  'prince of tennis', 'banana fish', 'spirited away', 'my neighbor totoro',
  'howls moving castle', 'grave of the fireflies', 'princess mononoke',
  'ponyo', 'arrietty', 'the tale of princess kaguya', 'the wind rises',
  'porco rosso', 'nausicaa', 'castle in the sky', 'laputa',
  'kikis delivery service', 'whisper of the heart', 'ghost in the shell',
  'neon genesis evangelion', 'fullmetal alchemist', 'attack on titan',
];

// Whole-word phrase match: "conan" no longer matches "Conan the Barbarian"
// (removed), and "gate" cannot match "Watergate". Candidates still have to be
// confirmed by a provider before reclassification.
function normalizeForKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const KEYWORD_RES = ANIME_KEYWORDS.map((k) => new RegExp(`(?:^| )${escapeRe(k)}(?: |$)`, 'i'));

function isAnimeKeyword(title) {
  const norm = normalizeForKeyword(title);
  if (!norm) return false;
  return KEYWORD_RES.some((re) => re.test(norm));
}

module.exports = { ANIME_KEYWORDS, isAnimeKeyword, normalizeForKeyword };

