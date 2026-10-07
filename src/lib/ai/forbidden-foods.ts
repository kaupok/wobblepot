/**
 * Keyword lists for the foods a household's allergens and dietary type rule
 * out, and the check that applies them to an AI-suggested meal (HON-895).
 *
 * Two callers share this module so they cannot disagree: `imagineMeals` drops
 * a suggestion that fails the check before it reaches the client, and the
 * model benchmark's imagine scorer (`scripts/model-bench/scorers.ts`) counts
 * the same failures. A benchmark "No forbidden ingredient" failure on an
 * allergen or diet therefore means the production guard failed too.
 *
 * Every rule matches the English and Estonian keywords together, whatever the
 * household locale: Estonian output borrows English food words ("parmesan",
 * "tofu"), and a model can answer in the wrong language. Matching is by
 * substring, because Estonian compounds ("suitsulõhe", "kanafilee") put the
 * keyword mid-word. That makes false friends inevitable ("naan" in "banaan",
 * "kala" in "kalamata"); each group lists the qualifiers that excuse them.
 *
 * Keep the lists conservative. A false positive drops one suggestion and may
 * cost a retry; a false negative shows a household a food it cannot eat.
 */

/** A set of foods with the words that name them and the words that excuse a match. */
export interface FoodGroup {
  /** Lower-case substrings, English and Estonian. */
  keywords: readonly string[]
  /**
   * Swap words: a keyword match is not a violation when one of these,
   * starting a word, contains it or sits directly before it ("vegan
   * parmesan", "kaerahapukoor", "almond milk"). The rule is
   * `findUnexcusedKeyword`. Qualifiers belong to their group: "almond"
   * excuses the milk in "almond milk" but never the almond for a nut allergy.
   */
  qualifiers: readonly string[]
  /**
   * Words that contain a keyword but are not the food ("eggplant", "nutmeg",
   * "kalamata", "banaan" for "naan"). A false friend excuses only the
   * keyword inside it, never the word after it, so "coconut almond milk"
   * still fails a nut allergy where a qualifier would have let it through.
   */
  falseFriends?: readonly string[]
  /**
   * Estonian swap prefixes that excuse only a keyword glued to them:
   * "sojahakkliha", "porgandilõhe". Unlike a qualifier they never reach
   * across a space, because "soja kanafilee" is soy sauce and chicken.
   */
  prefixes?: readonly string[]
  /**
   * Sauces and dishes whose ready-made form hides the food ("satay sauce",
   * "pesto", "tzatziki"), matched in ingredient names only. A safe adaptation
   * keeps the dish name ("Nut-free chicken satay" made with sunflower seed
   * butter), so matching them in the meal name would drop exactly the answer
   * the guard is asking for.
   */
  ingredientKeywords?: readonly string[]
}

/** Words that make an animal product a plant-based swap. Safe for animal-derived groups only. */
const PLANT_SWAP = ['vegan', 'plant-based', 'plant based', 'taimne', 'taimse', 'taimsed', 'taimset']

const MEAT: FoodGroup = {
  keywords: [
    'chicken',
    'poussin',
    'cornish hen',
    'game hen',
    'beef',
    'pork',
    'bacon',
    'pancetta',
    'prosciutto',
    'salami',
    'chorizo',
    'pepperoni',
    'ham',
    'gammon',
    'lamb',
    'mutton',
    'turkey',
    'duck',
    'veal',
    'venison',
    'goose',
    'rabbit',
    'goat',
    'steak',
    'sirloin',
    'ribeye',
    'rib-eye',
    'new york strip',
    'boar',
    'sausage',
    'meat',
    'mince',
    'guanciale',
    'gelatin',
    'gelatine',
    'lard',
    'suet',
    'bone broth',
    'kana',
    'broiler',
    'kalkun',
    'pardi',
    'hane',
    'veise',
    'sealiha',
    'seahakkliha',
    'seakael',
    'seapraad',
    'seafilee',
    'seakarbonaad',
    'seapekk',
    'seakints',
    'searibi',
    'lamba',
    'talle',
    'vasika',
    'hirve',
    'põdra',
    'küülik',
    'peekon',
    'sink',
    'singi',
    'vorst',
    'viiner',
    'karbonaad',
    'steik',
    // Goat: "kitsekarri", "kitsepraad". The goat dairy is a false friend.
    'kitse',
    // The pool's Estonian steaks that name no other MEAT keyword. A bare
    // "praad" would flag "köögiviljapraad".
    'filee praad',
    'fileepraad',
    'välisfilee',
    'sisefilee',
    'metssea',
    // Pork cuts written "sea …": a bare "sea " would flag sea bass and sea salt.
    'sea eskalopp',
    'seaeskalopp',
    'sea seljatükk',
    'seaseljatükk',
    'sea ribitükk',
    'searibitükk',
    'sea abatükk',
    'seaabatükk',
    'pekk',
    'peki',
    'salaami',
    'hakkliha',
    'liha',
    'luupuljong',
    'želatiin',
    'zelatiin',
  ],
  qualifiers: [
    ...PLANT_SWAP,
    'veggie',
    'vegetarian',
    'meatless',
    'meat-free',
    'soy',
    'soya',
    'tofu',
    'tempeh',
    'seitan',
    'lihata',
    'lihavaba',
    'taimetoit',
  ],
  prefixes: ['soja', 'seene', 'porgandi', 'tofu'],
  falseFriends: [
    'champignon',
    // The cut, not the meat. Named phrases only: a bare "minced" would excuse
    // "minced steak" too.
    'minced garlic',
    'minced ginger',
    'minced onion',
    'minced shallot',
    'minced chilli',
    'minced chili',
    'minced herbs',
    // Meat-free minces, named for what they are made of (HON-1098). Never a
    // qualifier: "mushroom" would excuse the chicken in "mushroom chicken pie".
    'quorn mince',
    'lentil mince',
    'plant mince',
    'mushroom mince',
    'vegetable mince',
    'champagne',
    'bechamel',
    'béchamel',
    'graham',
    'chamomile',
    'beefsteak tomato',
    // Goat dairy, not goat meat (HON-1106). DAIRY still catches it for a vegan.
    "goat's cheese",
    'goats cheese',
    "goats' cheese",
    'goat cheese',
    'goat milk',
    "goat's milk",
    'goats milk',
    "goats' milk",
    'goat yoghurt',
    'goat yogurt',
    "goat's yoghurt",
    "goat's yogurt",
    'goats yoghurt',
    'goats yogurt',
    "goat's curd",
    'goats curd',
    "goats' curd",
    'goat curd',
    'goat feta',
    'goat ricotta',
    'goat labneh',
    'goat cream cheese',
    'goat brie',
    'goat butter',
    'goat kefir',
    'kitsejuust',
    'kitse juust',
    'kitsepiim',
    'kitse piim',
    'kitsejogurt',
    'kitsekohupiim',
    'kitsevõi',
    'kitsekeefir',
    'kitsekefiir',
    // "cheese board" is not a wild boar.
    'board',
    // Fish and vegetable steaks. FISH still catches the fish ones for a vegetarian.
    'fish steak',
    'tuna steak',
    'salmon steak',
    'swordfish steak',
    'cod steak',
    'halibut steak',
    'cauliflower steak',
    'mushroom steak',
    'celeriac steak',
    'kalasteik',
    'tuunikalasteik',
    'lõhesteik',
    'lillkapsasteik',
    'seenesteik',
    'kalafilee praad',
    'kalafileepraad',
    'lõhefilee praad',
    'lõhefileepraad',
    // Meat-free condiments named after what they go with.
    'steak sauce',
    'steak seasoning',
    'collard',
    'vegetable suet',
    "lamb's lettuce",
    'lambs lettuce',
    'gooseberr',
    'duck egg',
    'coconut meat',
    'kanamuna',
    'kanapee',
  ],
}

const FISH: FoodGroup = {
  keywords: [
    'fish',
    'salmon',
    'tuna',
    'cod',
    'haddock',
    'trout',
    'mackerel',
    'sardine',
    'anchov',
    'herring',
    'pollock',
    'halibut',
    'tilapia',
    'sea bass',
    'seabass',
    'plaice',
    'snapper',
    'caviar',
    'gravlax',
    'lox',
    'sprat',
    'kipper',
    'surimi',
    'bonito',
    'dashi',
    'katsuobushi',
    'worcestershire',
    'kala',
    'lõhe',
    'forell',
    'makrell',
    'heeringa',
    'räim',
    'kilu',
    'tursk',
    'tursa',
    'angerja',
    'anšoovis',
    'anšovis',
    'ansoovis',
    'sardiin',
    'kaaviar',
    'gravlaks',
    'sprot',
    'ahven',
    'haug',
    'säga',
    'tilaapia',
    'hiidlest',
  ],
  qualifiers: [...PLANT_SWAP, 'fish-free', 'kalavaba'],
  prefixes: ['porgandi'],
  falseFriends: ['kalamata', 'lõhestatud'],
}

const SHELLFISH: FoodGroup = {
  keywords: [
    'shellfish',
    'shrimp',
    'prawn',
    'langoustine',
    'crayfish',
    'crawfish',
    'lobster',
    'crab',
    'mussel',
    'clam',
    'scallop',
    'cockle',
    'oyster',
    'squid',
    'calamari',
    'octopus',
    'cuttlefish',
    'krill',
    'scampi',
    'seafood',
    'krevet',
    'krabi',
    'homaar',
    'langust',
    'vähk',
    'vähi',
    'rannakarp',
    'rannakarb',
    'kammkarp',
    'kammkarb',
    'auster',
    'austri',
    'kalmaar',
    'kaheksajal',
    'seepia',
    'mereand',
    'mereanni',
  ],
  qualifiers: PLANT_SWAP,
  falseFriends: ['oyster mushroom', 'crab apple', 'austerseen', 'austriseen', 'austria'],
}

const DAIRY: FoodGroup = {
  keywords: [
    'milk',
    'cream',
    'half and half',
    'half-and-half',
    'crème',
    'creme',
    'butter',
    'cheese',
    'yogurt',
    'yoghurt',
    'kefir',
    'curd',
    'whey',
    'casein',
    'ghee',
    'custard',
    'quark',
    'fromage',
    'paneer',
    'labneh',
    'béchamel',
    'bechamel',
    'ricotta',
    'mascarpone',
    'mozzarella',
    'parmesan',
    'parmigiano',
    'pecorino',
    'cheddar',
    'gruyère',
    'gruyere',
    'feta',
    'halloumi',
    'brie',
    'camembert',
    'gouda',
    'emmental',
    'burrata',
    'manchego',
    'gorgonzola',
    'provolone',
    'piim',
    'kohupiim',
    'hapupiim',
    'petipiim',
    'täispiim',
    'lehmapiim',
    'kitsepiim',
    'koor',
    'hapukoor',
    'vahukoor',
    'kohvikoor',
    'toidukoor',
    'või',
    'juust',
    'kreemjuust',
    'toorjuust',
    'kodujuust',
    'riivjuust',
    'sulajuust',
    'fetajuust',
    'jogurt',
    'keefir',
    'kefiir',
    'vadak',
    'jäätis',
    'brioche',
  ],
  ingredientKeywords: ['pesto', 'tzatziki', 'tsatsiki', 'raita', 'alfredo'],
  qualifiers: [
    ...PLANT_SWAP,
    'plant',
    'taime',
    'dairy-free',
    'dairy free',
    'non-dairy',
    'oat',
    'soy',
    'soya',
    'coconut',
    'almond',
    'cashew',
    'rice milk',
    'hemp',
    'nut',
    'peanut',
    'sunflower seed',
    'seed butter',
    'piimavaba',
    'kaera',
    'soja',
    'kookos',
    'mandli',
    'kašu',
    'riisi',
    'maapähkli',
    'seesami',
  ],
  falseFriends: [
    'butternut',
    'butter bean',
    'butter lettuce',
    'cream of tartar',
    'cocoa butter',
    'shea butter',
    'kakaovõi',
    'sidrunikoor',
    'apelsinikoor',
    'laimikoor',
    'kooritud',
    'koorimata',
    // Tofu, not dairy curd (HON-1106).
    'bean curd',
    // British shop name for vegan parmesan; "vegan" cannot reach past "hard" (HON-1098).
    'vegan hard cheese',
  ],
}

const EGGS: FoodGroup = {
  keywords: [
    'egg',
    'mayonnaise',
    'mayo',
    'aioli',
    'meringue',
    'hollandaise',
    'muna',
    'majonees',
    'besee',
    'brioche',
    // Quorn's mycoprotein is bound with egg white, except the range sold as vegan.
    'quorn',
    // Fruit curd is egg yolk, whatever the fruit. The dairy and tofu curds are false friends.
    'curd',
  ],
  ingredientKeywords: ['carbonara', 'karbonaara', 'caesar'],
  qualifiers: [
    ...PLANT_SWAP,
    'eggless',
    'egg-free',
    'egg free',
    'flax',
    'chia',
    'aquafaba',
    'munavaba',
  ],
  falseFriends: [
    'eggplant',
    'veggie',
    'reggiano',
    'quorn vegan',
    'bean curd',
    'goat curd',
    "goat's curd",
    'goats curd',
    "goats' curd",
    'sheep curd',
    "sheep's curd",
    'cheese curd',
    'curd cheese',
  ],
}

const HONEY: FoodGroup = {
  keywords: ['honey', 'mesi'],
  qualifiers: PLANT_SWAP,
  falseFriends: ['honeydew', 'honeycrisp'],
}

const NUTS: FoodGroup = {
  keywords: [
    'almond',
    'walnut',
    'hazelnut',
    'cashew',
    'pecan',
    'pistachio',
    'macadamia',
    'brazil nut',
    'pine nut',
    'nut',
    'praline',
    'marzipan',
    'nutella',
    'frangipane',
    'mandel',
    'mandli',
    'pähk',
    'kašu',
    'pistaatsia',
    'makadaamia',
    'piiniaseem',
    'martsipan',
    'praliin',
  ],
  ingredientKeywords: ['pesto'],
  qualifiers: ['nut-free', 'nut free', 'pähklivaba'],
  falseFriends: [
    'coconut',
    'nutmeg',
    'nutrition',
    'butternut',
    'doughnut',
    'donut',
    'chestnut',
    'peanut',
    'minute',
    'maapähk',
    'muskaatpähk',
    'kookospähk',
  ],
}

const PEANUTS: FoodGroup = {
  keywords: ['peanut', 'groundnut', 'maapähk'],
  qualifiers: ['peanut-free', 'peanut free', 'maapähklivaba'],
  ingredientKeywords: ['satay', 'satai'],
}

const SOY: FoodGroup = {
  keywords: [
    'soy',
    'soja',
    'tofu',
    'tempeh',
    'edamame',
    'miso',
    'tamari',
    'shoyu',
    'natto',
    'bean curd',
  ],
  qualifiers: ['soy-free', 'sojavaba'],
  ingredientKeywords: ['teriyaki', 'hoisin'],
}

const GLUTEN: FoodGroup = {
  keywords: [
    'wheat',
    'flour',
    'bread',
    'panko',
    'pasta',
    'spaghetti',
    'macaroni',
    'penne',
    'fusilli',
    'fettuccine',
    'linguine',
    'rigatoni',
    'tagliatelle',
    'lasagn',
    'orzo',
    'farfalle',
    'ravioli',
    'tortellin',
    'gnocchi',
    'noodle',
    'udon',
    'ramen',
    'couscous',
    'bulgur',
    'barley',
    'oat',
    'rye',
    'semolina',
    'seitan',
    'spelt',
    'farro',
    'tortilla',
    'pita',
    'pitta',
    'naan',
    'crouton',
    'cracker',
    'biscuit',
    'pastry',
    'phyllo',
    'filo',
    'dumpling',
    'wonton',
    'beer',
    'malt',
    'soy sauce',
    'pizza',
    'bagel',
    'baguette',
    'ciabatta',
    'focaccia',
    'brioche',
    'croissant',
    'nisu',
    'jahu',
    'leib',
    'leiva',
    'sai',
    'spagett',
    'makaron',
    'nuudl',
    'kuskuss',
    'oder',
    'odra',
    'rukki',
    'rukis',
    'manna',
    'speltt',
    'lasanje',
    'raviool',
    'pelmeen',
    'õlu',
    'õlle',
    'linnas',
    'küpsis',
    'tainas',
    'taina',
    'kook',
    'koogi',
    'sojakaste',
    'kaer',
    'kruup',
    'kruub',
  ],
  // Grains swap in as false friends, never qualifiers: a qualifier also
  // excuses the keyword after it, so a bare "corn" or "rice" would pass
  // cornbread or "rice noodle soy sauce".
  qualifiers: ['gluten-free', 'gluten free', 'gluteenivaba'],
  falseFriends: [
    'goat',
    'rice noodle',
    'rice flour',
    'rice paper',
    'rice pasta',
    'rice vermicelli',
    'riisinuudl',
    'riisijahu',
    'riisipaber',
    'riisipasta',
    'corn tortilla',
    'cornflour',
    'corn flour',
    'corn pasta',
    'potato flour',
    'almond flour',
    'coconut flour',
    'chickpea flour',
    'chickpea pasta',
    'buckwheat flour',
    'buckwheat groats',
    'tapioca flour',
    'glass noodle',
    'pitaya',
    'maisijahu',
    'maisitortilla',
    'tatrajahu',
    'kikerhernejahu',
    'kartulijahu',
    'mandlijahu',
    'kookos',
    'klaasnuudl',
    'banaan',
    'tomatipasta',
    'küüslaugupasta',
    'karripasta',
    'seesamipasta',
    'ingveripasta',
    'pastinaak',
  ],
}

const SESAME: FoodGroup = {
  keywords: ['sesame', 'tahini', 'tahina', 'halva', "za'atar", 'zaatar', 'seesam', 'tahiin'],
  qualifiers: ['sesame-free', 'seesamivaba'],
  ingredientKeywords: ['hummus'],
}

/** `Allergen` in `prisma/schema.prisma` → the foods it rules out. */
const ALLERGEN_GROUPS: Record<string, FoodGroup> = {
  gluten: GLUTEN,
  dairy: DAIRY,
  eggs: EGGS,
  nuts: NUTS,
  peanuts: PEANUTS,
  soy: SOY,
  fish: FISH,
  shellfish: SHELLFISH,
  sesame: SESAME,
}

/** `DietaryType` in `prisma/schema.prisma` → the foods it rules out. */
const DIET_GROUPS: Record<string, readonly FoodGroup[]> = {
  pescatarian: [MEAT],
  vegetarian: [MEAT, FISH, SHELLFISH],
  vegan: [MEAT, FISH, SHELLFISH, DAIRY, EGGS, HONEY],
}

export type ConstraintKind = 'allergen' | 'diet' | 'case'

/** One thing a meal must not contain, with the words that detect it. */
export interface ForbiddenFoodRule {
  /** The allergen or dietary type, e.g. `shellfish`, `vegan`. */
  constraint: string
  kind: ConstraintKind
  /** Each group is checked against its own qualifiers, never a pooled set. */
  groups: readonly FoodGroup[]
  /**
   * Whether the meal name is checked as well as its ingredients. True for
   * allergens: "Kalamaki" names a fish maki whatever its ingredient list says.
   * False for diets: vegan dishes are named after what they imitate
   * ("Vegan mac and cheese"), and the ingredient list is what decides it.
   */
  checkMealName: boolean
}

/**
 * The rules for a household's allergens and dietary type. A value this module
 * does not know contributes no rule rather than throwing;
 * `forbidden-foods.test.ts` asserts every Prisma enum member is covered.
 */
export function rulesForHousehold(household: {
  allergens: readonly string[]
  dietaryType: string | null
}): ForbiddenFoodRule[] {
  const rules: ForbiddenFoodRule[] = []
  for (const allergen of household.allergens) {
    const group = ALLERGEN_GROUPS[allergen]
    if (group) {
      rules.push({ constraint: allergen, kind: 'allergen', groups: [group], checkMealName: true })
    }
  }
  const diet = household.dietaryType
  const dietGroups = diet ? DIET_GROUPS[diet] : undefined
  if (diet && dietGroups) {
    rules.push({ constraint: diet, kind: 'diet', groups: dietGroups, checkMealName: false })
  }
  return rules
}

/** Every allergen and dietary type the lists cover. */
export const COVERED_ALLERGENS = Object.keys(ALLERGEN_GROUPS)
export const COVERED_DIETS = Object.keys(DIET_GROUPS)

/** Curly apostrophes fold to `'`, so "goat’s cheese" meets the "goat's cheese" false friend. */
export const normalizeFoodName = (name: string) =>
  name
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .trim()
    .toLowerCase()

interface Span {
  start: number
  end: number
}

function spansOf(name: string, needle: string): Span[] {
  const spans: Span[] = []
  for (let i = name.indexOf(needle); i !== -1; i = name.indexOf(needle, i + 1)) {
    spans.push({ start: i, end: i + needle.length })
  }
  return spans
}

/** A span that excuses keywords: a qualifier, a prefix, or an already-excused keyword. */
interface Covering extends Span {
  reachesAcrossSpace: boolean
}

const startsWord = (name: string, i: number) => i === 0 || !/\p{L}/u.test(name[i - 1]!)

/**
 * The first keyword in `name` that nothing excuses, or `null`. Expects
 * normalized (lower-case) input.
 *
 * A false friend excuses a keyword it wholly contains ("nutmeg", "kalamata")
 * and nothing else. A qualifier counts only where it starts a word ("oat
 * milk" is not in "goat milk"), and excuses a keyword it overlaps or that
 * follows it after nothing but spaces ("vegan parmesan", "kaerahapukoor").
 * A prefix does the same with no space allowed ("sojahakkliha").
 * An excused keyword excuses the next one the same way, so "plant-based
 * cream cheese" passes, while "honey soy sauce", "coconut milk and butter"
 * and "kalamata oliivid ja parmesan" fail (HON-841).
 */
export function findUnexcusedKeyword(
  name: string,
  keywords: readonly string[],
  qualifiers: readonly string[],
  falseFriends: readonly string[] = [],
  prefixes: readonly string[] = [],
): string | null {
  const friends = falseFriends.flatMap((f) => spansOf(name, f))
  const atWordStart = (words: readonly string[]) =>
    words.flatMap((w) => spansOf(name, w).filter((s) => startsWord(name, s.start)))
  const covered: Covering[] = [
    ...atWordStart(qualifiers).map((s) => ({ ...s, reachesAcrossSpace: true })),
    ...atWordStart(prefixes).map((s) => ({ ...s, reachesAcrossSpace: false })),
  ]
  let pending = keywords
    .flatMap((kw) => spansOf(name, kw).map((s) => ({ ...s, kw })))
    .filter((hit) => !friends.some((f) => f.start <= hit.start && hit.end <= f.end))
  const excuses = (c: Covering, hit: Span) =>
    c.start <= hit.start &&
    (hit.start < c.end ||
      (c.reachesAcrossSpace ? /^\s*$/ : /^$/).test(name.slice(c.end, hit.start)))

  for (;;) {
    const excused = pending.filter((hit) => covered.some((c) => excuses(c, hit)))
    if (excused.length === 0) {
      if (pending.length === 0) return null
      return pending.reduce((first, hit) => (hit.start < first.start ? hit : first)).kw
    }
    covered.push(...excused.map((hit) => ({ ...hit, reachesAcrossSpace: true })))
    pending = pending.filter((hit) => !excused.includes(hit))
  }
}

/** A meal that breaks a rule, with the first word that gave it away. */
export interface FoodViolation {
  constraint: string
  kind: ConstraintKind
  keyword: string
  /** Where the keyword was found. */
  field: 'name' | 'ingredient'
  /** The meal name or ingredient name, as the model wrote it. */
  text: string
}

/** The parts of a meal the check reads. */
type CheckedMeal = { name: string; ingredients: readonly { name: string }[] }

function firstHit(
  text: string,
  field: FoodViolation['field'],
  rule: ForbiddenFoodRule,
): string | null {
  const name = normalizeFoodName(text)
  for (const group of rule.groups) {
    const keywords =
      field === 'ingredient' && group.ingredientKeywords
        ? [...group.keywords, ...group.ingredientKeywords]
        : group.keywords
    const keyword = findUnexcusedKeyword(
      name,
      keywords,
      group.qualifiers,
      group.falseFriends,
      group.prefixes,
    )
    if (keyword) return keyword
  }
  return null
}

/**
 * Every rule the meal breaks, at most one violation per rule: the meal name
 * first (for rules that check it), then the ingredients in order. An empty
 * array means the meal is safe to show.
 */
export function findViolations(
  meal: CheckedMeal,
  rules: readonly ForbiddenFoodRule[],
): FoodViolation[] {
  const violations: FoodViolation[] = []
  for (const rule of rules) {
    const texts = [
      ...(rule.checkMealName ? [{ field: 'name' as const, text: meal.name }] : []),
      ...meal.ingredients.map((ing) => ({ field: 'ingredient' as const, text: ing.name })),
    ]
    for (const { field, text } of texts) {
      const keyword = firstHit(text, field, rule)
      if (keyword) {
        violations.push({ constraint: rule.constraint, kind: rule.kind, keyword, field, text })
        break
      }
    }
  }
  return violations
}

/** Split meals into those safe to show and those that break a rule. */
export function partitionMeals<M extends CheckedMeal>(
  meals: readonly M[],
  rules: readonly ForbiddenFoodRule[],
): { kept: M[]; dropped: { meal: M; violations: FoodViolation[] }[] } {
  const kept: M[] = []
  const dropped: { meal: M; violations: FoodViolation[] }[] = []
  for (const meal of meals) {
    const violations = findViolations(meal, rules)
    if (violations.length === 0) kept.push(meal)
    else dropped.push({ meal, violations })
  }
  return { kept, dropped }
}
