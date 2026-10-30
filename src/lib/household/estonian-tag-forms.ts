/**
 * The tables of the Estonian part-of-word rule of "Ingredients to avoid"
 * (HON-1477). Estonian writes most foods as compounds ("kanafilee",
 * "riisijahu"), so `matchTag` matches a one-word tag inside a word of an
 * Estonian name. These tables hold the exceptions that rule cannot derive.
 * Keys are tags in lower case.
 */

/**
 * More forms of a tag, each matched as part of a word. Estonian changes the
 * stem of some words in a compound ("lammas", but "lambahakkliha"), and the
 * catalogue once spelled broccoli "brokkoli".
 */
export const ESTONIAN_TAG_FORMS: Readonly<Record<string, readonly string[]>> = {
  // lambahakkliha, lambakotlet
  lammas: ['lamba'],
  // pardirind, pardirasv
  part: ['pardi'],
  // rukkileib
  rukis: ['rukki'],
  // mandlid, mandlijahu, mandlipiim
  mandel: ['mandli'],
  // maapähkliõli, maapähklivõi: the same -el → -li change as mandel
  maapähkel: ['maapähkli'],
  // The catalogue has no compound of these three yet; an own row may
  // ("kurgisalat", "tatrahelbed", "odrakruup").
  kurk: ['kurgi'],
  tatar: ['tatra'],
  oder: ['odra'],
  // küüslaugupulber, küüslaugusool
  küüslauk: ['küüslaugu'],
  // The catalogue spelling before HON-1477; the dictionary word is "brokoli".
  brokkoli: ['brokoli'],
}

/**
 * Text that holds a tag but names another food. A translated name that
 * contains one of these does not match the tag, by part, as whole words or
 * through the English name of a matched row.
 * Each entry applies to every form of its tag, and to a plural tag: "tomatid"
 * reads the entry of "tomat", "herned" the entry of "hernes".
 */
export const ESTONIAN_FALSE_FRIENDS: Readonly<Record<string, readonly string[]>> = {
  // kookosesoja is coconut aminos, not soy.
  soja: ['kookosesoja'],
  // kikerherned are chickpeas, not peas.
  hernes: ['kikerhern'],
  // pärlkana is guinea fowl.
  kana: ['pärlkana'],
  // meekaste melon is honeydew, not a sauce.
  kaste: ['meekaste'],
  // Pastes whose name is two words, so the whole-word rule reads them.
  pasta: ['achiote pasta', 'awaze pasta', 'mole pasta'],
  // kurkum is turmeric.
  kurk: ['kurkum'],
  // jahubanaan is plantain, not flour.
  jahu: ['jahubanaan'],
  // sidrunhein is lemongrass; sidruntüümian lemon thyme, sidrunverbena lemon verbena.
  sidrun: ['sidrunhein', 'sidruntüümian', 'sidrunverbena'],
  // tortilla and tomatillo are not dill; apteegitill is fennel.
  till: ['tortilla', 'tomatillo', 'apteegitill'],
  // kookos is coconut, not cake.
  kook: ['kookos'],
  // Cherry and plum tomatoes are tomatoes, not cherries or plums.
  kirss: ['tomat'],
  ploom: ['tomat'],
  // maapirn is Jerusalem artichoke, not pear.
  pirn: ['maapirn'],
  // mädarõigas is horseradish, not radish.
  rõigas: ['mädarõ'],
  // salatikaste is salad dressing, not lettuce.
  salat: ['salatikaste'],
  // kõrvitsapiruka vürtsisegu is pumpkin pie spice.
  kõrvits: ['kõrvitsapiruka'],
  // lambalääts is fenugreek, not lentils.
  lääts: ['lambaläät'],
  // sinepilehed are mustard greens.
  sinep: ['sinepilehed'],
  // granaatõun is pomegranate, not apple.
  õun: ['granaatõun'],
  // kapparid soolvees are capers in brine.
  sool: ['soolvees'],
  // banaanipaprika is banana pepper.
  banaan: ['banaanipaprika'],
  // kooritud means peeled; tofukoor is tofu skin.
  koor: ['kooritud', 'tofukoor'],
  // kookosviljaliha is coconut flesh, not meat.
  liha: ['kookosviljaliha'],
  tomat: ['tomatillo'],
  // lambalääts is fenugreek, lambaläätse lehed its leaves.
  lammas: ['lambaläät'],
  // tatarikaste is tartar sauce, not buckwheat.
  tatar: ['tatari'],
}

/**
 * Tags that match whole words only, and their plurals. In Estonian "pasta" is also paste, and
 * every compound in the catalogue is a paste (tomatipasta, karripasta).
 */
export const ESTONIAN_WHOLE_WORD_ONLY: ReadonlySet<string> = new Set(['pasta'])
