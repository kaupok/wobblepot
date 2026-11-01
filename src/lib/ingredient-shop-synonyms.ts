/**
 * Second names an Estonian shop or recipe uses for a global ingredient: a pack
 * name, a spelling or an English shop word. A translation row holds one
 * Estonian name per ingredient, so every other name goes here.
 *
 * Spread into `INGREDIENT_SYNONYMS`, so the same rules apply (`pnpm db:validate`).
 * A key must not repeat one in that table: the spread would drop it silently.
 */
export const SHOP_INGREDIENT_SYNONYMS: Record<string, string> = {
  // Shop names for one-pack mixes and the seeds, nuts and pastes in them
  // (HON-1545). A translation row holds one Estonian name, so a second one
  // goes here. A plain "marjasegu" is the frozen bag, as an Estonian shop sells it.
  'mixed seeds': 'seed mix',
  'salad seed mix': 'seed mix',
  'salatiseemnete segu': 'seed mix',
  'nut mix': 'mixed nuts',
  wokisegu: 'frozen stir-fry vegetables',
  wokiköögiviljad: 'frozen stir-fry vegetables',
  'stir-fry vegetable mix': 'frozen stir-fry vegetables',
  'wok vegetables': 'frozen stir-fry vegetables',
  'india pähklid': 'cashews',
  'india pähkli või': 'cashew butter',
  kašupähklivõi: 'cashew butter',
  seesamipasta: 'tahini',
  'sesame paste': 'tahini',
  sesame: 'sesame seeds',
  seesam: 'sesame seeds',
  chia: 'chia seeds',
  linseed: 'flax seeds',
  linseeds: 'flax seeds',
  marjasegu: 'frozen mixed berries',
  metsamarjasegu: 'frozen mixed berries',

  // Second shop names for cacao nibs, kama, spelt flour and grain flakes (HON-1548)
  'cocoa nibs': 'cacao nibs',
  kakaonibsid: 'cacao nibs',
  kakaotuumad: 'cacao nibs',
  'kama flour': 'kama',
  speltanisujahu: 'spelt flour',
  'spelta jahu': 'spelt flour',
  'toor-tatra kama': 'buckwheat kama',
  'toortatra kama': 'buckwheat kama',
  'tatra kama': 'buckwheat kama',
  '4-vilja helbed': 'four-grain flakes',
  'neljavilja helbed': 'four-grain flakes',
  '4-grain flakes': 'four-grain flakes',

  // Spice-rack and pickle-shelf names from an Estonian shop (HON-1553). The
  // new rows' own Estonian names are translations; these are the other spellings.
  sidrunipipar: 'lemon pepper seasoning',
  'sidrunipipra maitseaine': 'lemon pepper seasoning',
  'lemon pepper': 'lemon pepper seasoning',
  karri: 'curry powder',
  'suitsutatud paprika': 'smoked paprika',
  'suitsutatud paprikapulber': 'smoked paprika',
  suitsupaprika: 'smoked paprika',
  'taco maitseaine': 'taco seasoning',
  ingveripulber: 'ground ginger',
  'kana maitseaine': 'chicken seasoning',
  'chicken spice mix': 'chicken seasoning',
  'grill seasoning mix': 'grill seasoning',
  grillimaitseaine: 'grill seasoning',
  'marineeritud kurk': 'pickled gherkins',
  'marineeritud kurgid': 'pickled gherkins',
  gherkins: 'pickled gherkins',
  pickles: 'pickled gherkins',
  'dill pickles': 'pickled gherkins',
  'crispy onions': 'crispy fried onions',
  // Plain "suhkur" is the granulated sugar, as English "sugar" is in INGREDIENT_ALIASES
  suhkur: 'granulated sugar',
}
