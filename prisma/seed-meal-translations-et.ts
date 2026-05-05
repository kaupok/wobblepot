export type MealTranslationEt = {
  enName: string
  et: {
    name: string
    description: string | null
  }
}

export const mealTranslationsEt: MealTranslationEt[] = [
  // ============================================================
  // baseMeals — POULTRY
  // ============================================================
  {
    enName: 'Grilled Chicken Breast with Rice',
    et: {
      name: 'Grillitud kanafilee riisiga',
      description: 'Lihtne grillitud kanafilee aurutatud riisi ja köögiviljadega.',
    },
  },
  {
    enName: 'Chicken Stir-Fry',
    et: {
      name: 'Kana wok köögiviljadega',
      description: 'Kiirelt wokis praetud kana kirjute paprikate ja brokoliga.',
    },
  },
  {
    enName: 'Chicken Curry',
    et: {
      name: 'Kanakarri',
      description: 'Kreemjas kanakarri aromaatsete vürtsidega.',
    },
  },
  {
    enName: 'Chicken Pasta',
    et: {
      name: 'Kana-pasta parmesan',
      description: 'Kreemjas pasta grillitud kanaga ja parmesaniga.',
    },
  },
  {
    enName: 'Baked Chicken Thighs',
    et: {
      name: 'Ahjukanakoivad kartulitega',
      description: 'Ürdirosmariiniga ahjus küpsetatud kanakoivad ja kartulid.',
    },
  },
  {
    enName: 'Turkey Meatballs',
    et: {
      name: 'Kalkuni lihapallid',
      description: 'Lahjad kalkuni lihapallid tomatikastmes.',
    },
  },
  // ============================================================
  // baseMeals — BEEF
  // ============================================================
  {
    enName: 'Beef Stir-Fry with Noodles',
    et: {
      name: 'Veiseliha wok nuudlitega',
      description: 'Kiirelt wokis praetud veiseliha munanudlite ja paprikaga.',
    },
  },
  {
    enName: 'Spaghetti Bolognese',
    et: {
      name: 'Spaghetti Bolognese',
      description: 'Klassikaline Itaalia hakklihakaste spagettiga.',
    },
  },
  {
    enName: 'Beef Tacos',
    et: {
      name: 'Veiseliha tacod',
      description: 'Maitsestatud hakkliha maisitortilladel tomatite ja hapukoorega.',
    },
  },
  {
    enName: 'Grilled Steak with Sweet Potato',
    et: {
      name: 'Grillitud steik bataadiga',
      description: 'Pannil praetud steik ahjus röstitud bataadiga.',
    },
  },
  {
    enName: 'Beef and Broccoli',
    et: {
      name: 'Veiseliha brokoliga',
      description: 'Klassikaline hiina stiilis veiseliha brokoliga sojakastmes.',
    },
  },
  // ============================================================
  // baseMeals — PORK
  // ============================================================
  {
    enName: 'Pork Tenderloin with Vegetables',
    et: {
      name: 'Seafilee köögiviljadega',
      description: 'Ahjus küpsetatud seafileed hooajaliste köögiviljadega.',
    },
  },
  {
    enName: 'Pork Chops with Apple',
    et: {
      name: 'Seakotletid karamelliseeritud õunaga',
      description: 'Pannil praetud seakotletid karamelliseeritud õunaga.',
    },
  },
  {
    enName: 'Bacon and Egg Breakfast',
    et: {
      name: 'Peekon ja munad',
      description: 'Klassikaline hommikusöök krõbeda peekoniga ja praetud munadega.',
    },
  },
  {
    enName: 'Pork Fried Rice',
    et: {
      name: 'Sealiha praetud riis',
      description: 'Aasia stiilis praetud riis sealihaga, muna ja köögiviljadega.',
    },
  },
  // ============================================================
  // baseMeals — LAMB
  // ============================================================
  {
    enName: 'Lamb Chops with Mint',
    et: {
      name: 'Lambakotletid müntkastmega',
      description: 'Grillitud lambakotletid värske müntkastmega.',
    },
  },
  {
    enName: 'Lamb Curry',
    et: {
      name: 'Lambakarri',
      description: 'Aeglaselt hautatud lambaliha aromaatses karrikastmes.',
    },
  },
  // ============================================================
  // baseMeals — FISH
  // ============================================================
  {
    enName: 'Baked Salmon with Asparagus',
    et: {
      name: 'Ahjulõhe sparglitega',
      description: 'Ahjus küpsetatud lõhefilee röstitud spargli ja sidruniga.',
    },
  },
  {
    enName: 'Fish and Chips',
    et: {
      name: 'Fish and chips',
      description: 'Klassikaline taignas tursk ja ahjukartulikiilud.',
    },
  },
  {
    enName: 'Tuna Pasta Salad',
    et: {
      name: 'Tuunikala-pastasalat',
      description: 'Külm pastasalat tuunikala, tomatite ja kurgiga.',
    },
  },
  {
    enName: 'Salmon Teriyaki',
    et: {
      name: 'Lõhe teriyaki',
      description: 'Pannil praetud lõhe teriyakikastmega, riisi ja brokoliga.',
    },
  },
  {
    enName: 'Shrimp Stir-Fry',
    et: {
      name: 'Krevetid wokis',
      description: 'Kiiresti wokis praetud krevetid paprika ja suvikõrvitsaga.',
    },
  },
  {
    enName: 'Grilled Cod with Quinoa',
    et: {
      name: 'Grillitud tursk kinoa salatiga',
      description: 'Kerge grillitud tursk kinoa, tomatite ja kurgiga.',
    },
  },
  // ============================================================
  // baseMeals — EGGS
  // ============================================================
  {
    enName: 'Vegetable Omelette',
    et: {
      name: 'Köögivilja omlett',
      description: 'Kohev omlett paprika, sibula ja juustuga.',
    },
  },
  {
    enName: 'Shakshuka',
    et: {
      name: 'Shakshuka',
      description: 'Munad pošireeritud vürtsika tomatikastme sees.',
    },
  },
  {
    enName: 'Egg Fried Rice',
    et: {
      name: 'Munapraetud riis',
      description: 'Lihtne praetud riis muna, herneste ja porgandiga.',
    },
  },
  {
    enName: 'Scrambled Eggs with Toast',
    et: {
      name: 'Munaroog röstsaiaga',
      description: 'Kreemjad munaroad võiga röstsaial.',
    },
  },
  {
    enName: 'Frittata',
    et: {
      name: 'Frittata',
      description: 'Itaalia stiilis ahjus küpsetatud munakoogike kartuli ja juustuga.',
    },
  },
  // ============================================================
  // baseMeals — LEGUMES
  // ============================================================
  {
    enName: 'Chickpea Curry',
    et: {
      name: 'Kikerhernekarri',
      description: 'Kreemjas kikerhernekarri aromaatsete vürtsidega.',
    },
  },
  {
    enName: 'Black Bean Tacos',
    et: {
      name: 'Mustaubade tacod',
      description: 'Taimetoitlased tacod maitsestatud mustaubade täidisega.',
    },
  },
  {
    enName: 'Lentil Soup',
    et: {
      name: 'Läätsesupp',
      description: 'Rammus läätsesupp köögiviljadega.',
    },
  },
  {
    enName: 'Tofu Stir-Fry',
    et: {
      name: 'Tofu wokis',
      description: 'Krõbe tofu köögiviljadega sojakastmes.',
    },
  },
  {
    enName: 'Falafel Bowl',
    et: {
      name: 'Falafelkauss',
      description: 'Kikerhernefalafeli kinoa, kurgi ja tomatiga.',
    },
  },
  {
    enName: 'Tempeh Teriyaki',
    et: {
      name: 'Tempeh teriyaki',
      description: 'Teriyakikastmes glaseeritud tempeh riisi ja köögiviljadega.',
    },
  },
  {
    enName: 'Bean and Rice Bowl',
    et: {
      name: 'Oa-riisikauss',
      description: 'Lihtne neeruoad riisi ja köögiviljadega.',
    },
  },
  {
    enName: 'Edamame Rice Bowl',
    et: {
      name: 'Edamame-riisikauss',
      description: 'Valgurikas edamamekauss köögiviljadega.',
    },
  },
  // ============================================================
  // baseMeals — DAIRY
  // ============================================================
  {
    enName: 'Mac and Cheese',
    et: {
      name: 'Makaroni juustukastmes',
      description: 'Klassikaline kreemjas makaroni juustukastmega.',
    },
  },
  {
    enName: 'Greek Salad with Feta',
    et: {
      name: 'Kreeka salat fetaga',
      description: 'Värske salat tomatite, kurgi ja feta juustuga.',
    },
  },
  {
    enName: 'Cheese Quesadilla',
    et: {
      name: 'Juustu quesadilla',
      description: 'Krõbe tortilla sulatatud juustutäidisega.',
    },
  },
  {
    enName: 'Caprese Salad',
    et: {
      name: 'Caprese salat',
      description: 'Värske mozzarella tomati ja basiilikuga.',
    },
  },
  // ============================================================
  // baseMeals — VEGETABLE-ONLY (none)
  // ============================================================
  {
    enName: 'Vegetable Stir-Fry',
    et: {
      name: 'Köögivilja wok',
      description: 'Köögiviljasegu küüslaugukastmes riisiga.',
    },
  },
  {
    enName: 'Garden Salad',
    et: {
      name: 'Aedviljasalat',
      description: "Värske seguslati vinaigrette'iga.",
    },
  },
  {
    enName: 'Roasted Vegetables',
    et: {
      name: 'Ahjuköögiviljad',
      description: 'Ahjus röstitud hooajalised köögiviljad.',
    },
  },
  {
    enName: 'Mushroom Risotto',
    et: {
      name: 'Seente risotto',
      description: 'Kreemjas risotto praetud seentega.',
    },
  },
  {
    enName: 'Vegetable Pasta',
    et: {
      name: 'Köögivilja pasta',
      description: 'Pasta praetud köögiviljadega oliiviõlis.',
    },
  },
  // ============================================================
  // baseMeals — BREAKFAST
  // ============================================================
  {
    enName: 'Overnight Oats',
    et: {
      name: 'Öine kaerapuder',
      description: 'Öö jooksul leotatud kaer puuviljade ja pähklitega.',
    },
  },
  {
    enName: 'Avocado Toast',
    et: {
      name: 'Avokaadoröstsai',
      description: 'Röstleib püreeritud avokaadoga.',
    },
  },
  {
    enName: 'Greek Yogurt Bowl',
    et: {
      name: 'Kreeka jogurtikauss',
      description: 'Kreemjas jogurt puuviljade ja granoladega.',
    },
  },
  {
    enName: 'Banana Pancakes',
    et: {
      name: 'Banaanipannkoogid',
      description: 'Kohevad pannkoogid banaani ja vahtrasiirupiga.',
    },
  },
  // ============================================================
  // baseMeals — VEGAN (none protein)
  // ============================================================
  {
    enName: 'Ratatouille',
    et: {
      name: 'Ratatouille',
      description: "Klassikaline Prantsuse Provence'i köögiviljahautis.",
    },
  },
  {
    enName: 'Stuffed Bell Peppers',
    et: {
      name: 'Täidetud paprikad',
      description: 'Paprikad täidetud riisi ja köögiviljadega.',
    },
  },
  {
    enName: 'Coconut Vegetable Curry',
    et: {
      name: 'Kookos-köögiviljadekarri',
      description: 'Kreemjas kookospiimapõhine karri segaköögiviljadega.',
    },
  },
  {
    enName: 'Cauliflower Steaks',
    et: {
      name: 'Lillkapsa steigid',
      description: 'Ahjus röstitud lillkapsa steigid ürtidega.',
    },
  },
  {
    enName: 'Butternut Squash Soup',
    et: {
      name: 'Kõrvitsasupp',
      description: 'Kreemjas röstitud muskaatkõrvitsa supp.',
    },
  },
  {
    enName: 'Mediterranean Grain Bowl',
    et: {
      name: 'Vahemere teraviljakauss',
      description: 'Kinoa röstitud köögiviljadega ja hummusega.',
    },
  },
  {
    enName: 'Pad Thai Vegetables',
    et: {
      name: 'Köögivilja Pad Thai paprikaga',
      description: 'Riisiinuudlid köögiviljadega hapus-magusas kastmes.',
    },
  },
  {
    enName: 'Sweet Potato Buddha Bowl',
    et: {
      name: 'Bataadi buddha kauss',
      description: 'Röstitud bataat kinoa, lehtkapsase ja avokaadoga.',
    },
  },
  {
    enName: 'Mushroom Stroganoff',
    et: {
      name: 'Seene stroganoff',
      description: 'Kreemjas seene stroganoff pastaga.',
    },
  },
  {
    enName: 'Moroccan Spiced Vegetables',
    et: {
      name: 'Maroko vürtsiköögiviljad',
      description: 'Põhja-Aafrika stiilis vürtsitatud köögiviljahautis kuskussiga.',
    },
  },
  {
    enName: 'Vegetable Fried Rice',
    et: {
      name: 'Köögivilja praetud riis',
      description: 'Aasia stiilis praetud riis segaköögiviljadega.',
    },
  },
  {
    enName: 'Roasted Brussels Sprouts Bowl',
    et: {
      name: 'Röstitud rooskapsakauss',
      description: 'Krõbedad röstitud rooskapsad teraviljaga.',
    },
  },
  // ============================================================
  // baseMeals — VEGAN legume
  // ============================================================
  {
    enName: 'Red Lentil Dal',
    et: {
      name: 'Punase läätse dal',
      description: 'Kreemjas India läätsehautis vürtsidega.',
    },
  },
  {
    enName: 'Seitan Stir-Fry',
    et: {
      name: 'Seitan wokis',
      description: 'Kõrge valgusisaldusega seitan köögiviljadega.',
    },
  },
  {
    enName: 'Black Bean Soup',
    et: {
      name: 'Musta oa supp',
      description: 'Rammus musta oa supp köögiviljadega.',
    },
  },
  {
    enName: 'Tofu Curry',
    et: {
      name: 'Tofukarri',
      description: 'Vürtsikas tofu kookospiima karrikastmes.',
    },
  },
  {
    enName: 'White Bean Pasta',
    et: {
      name: 'Valge oa pasta',
      description: 'Pasta kreemja valge oa kastmega ja spinatiga.',
    },
  },
  {
    enName: 'Tempeh Buddha Bowl',
    et: {
      name: 'Tempeh buddha kauss',
      description: 'Marineeritud tempeh teravilja ja köögiviljadega.',
    },
  },
  {
    enName: 'Split Pea Soup',
    et: {
      name: 'Herneste supp',
      description: 'Klassikaline kooritud herneste supp köögiviljadega.',
    },
  },
  {
    enName: 'Pinto Bean Burrito Bowl',
    et: {
      name: 'Pintooa burritokauss',
      description: 'Mehhiko stiilis kauss pintooaga.',
    },
  },
  {
    enName: 'Miso Tofu Soup',
    et: {
      name: 'Miso tofu supp',
      description: 'Jaapani stiilis misosupp tofuga.',
    },
  },
  {
    enName: 'Navy Bean Stew',
    et: {
      name: 'Valge oa hautis',
      description: 'Rammus valge oa hautis köögiviljadega.',
    },
  },
  // ============================================================
  // baseMeals — ADDITIONAL (other protein types)
  // ============================================================
  {
    enName: 'Herb Crusted Salmon',
    et: {
      name: 'Ürdikoorikuga lõhe',
      description: 'Ahjus küpsetatud lõhe ürdikoorikuga.',
    },
  },
  {
    enName: 'Teriyaki Chicken Bowl',
    et: {
      name: 'Teriyaki kanafileekauss',
      description: 'Grillitud kana teriyakikaste, riisi ja brokoliga.',
    },
  },
  {
    enName: 'Beef Burrito Bowl',
    et: {
      name: 'Veiseliha burritokauss',
      description: 'Mehhiko stiilis kauss maitsestatud veiselihaga.',
    },
  },
  {
    enName: 'Lemon Herb Chicken',
    et: {
      name: 'Sidruniürtide kana',
      description: 'Küpsetatud kana sidruni ja ürtidega.',
    },
  },
  {
    enName: 'Pork Stir-Fry with Vegetables',
    et: {
      name: 'Sealiha wok aasia köögiviljadega',
      description: 'Kiire sealiha wok aasia köögiviljadega.',
    },
  },
  {
    enName: 'Cod with Vegetables',
    et: {
      name: 'Tursk köögiviljadega',
      description: 'Ahjus küpsetatud tursk röstitud köögiviljadega.',
    },
  },
  {
    enName: 'Spinach Frittata',
    et: {
      name: 'Spinati frittata',
      description: 'Ahjus küpsetatud munapirukas spinati ja juustuga.',
    },
  },
  {
    enName: 'Cottage Cheese Bowl',
    et: {
      name: 'Kodujuustukauss',
      description: 'Valgurikas kodujuustukauss kurgi ja tomatiga.',
    },
  },
  // ============================================================
  // baseMeals — ADDITIONAL POULTRY
  // ============================================================
  {
    enName: 'Chicken Caesar Salad',
    et: {
      name: 'Kana Caesari salat',
      description: "Klassikaline Caesari salat grillitud kanafilee'ga.",
    },
  },
  {
    enName: 'Orange Chicken',
    et: {
      name: 'Apelsinikana',
      description: 'Krõbedad kanatükid magusas apelsinikastmes.',
    },
  },
  {
    enName: 'Turkey Burgers',
    et: {
      name: 'Kalkuniburgerid',
      description: 'Lahjad kalkuni kotletid värskete lisanditega.',
    },
  },
  {
    enName: 'Honey Garlic Chicken',
    et: {
      name: 'Mesi-küüslaugu kanakoivad',
      description: 'Kleepuvad mesi-küüslaugukastmes glaseeritud kanakoivad.',
    },
  },
  {
    enName: 'Chicken Quesadillas',
    et: {
      name: 'Kana quesadillad',
      description: 'Krõbedad tortillad kana ja juustuga.',
    },
  },
  {
    enName: 'Greek Chicken Bowl',
    et: {
      name: 'Kreeka kanakauss',
      description: 'Vahemere stiilis kana kinoa ja köögiviljadega.',
    },
  },
  {
    enName: 'Chicken Fajitas',
    et: {
      name: 'Kana fajitad',
      description: 'Krõbedad kanaribad paprika ja sibulaga tortillas.',
    },
  },
  {
    enName: 'Chicken Parmesan',
    et: {
      name: 'Kana parmesan',
      description: 'Riivsaias paneeritud kana tomatikaste ja sulatatud juustuga.',
    },
  },
  {
    enName: 'Thai Basil Chicken',
    et: {
      name: 'Tai basiilikukana',
      description: 'Vürtsikas praetud kana Tai basiilikuga.',
    },
  },
  {
    enName: 'Lemon Chicken Soup',
    et: {
      name: 'Sidruni-kanasupp',
      description: 'Lohutav kanasupp sidruni ja riisiga.',
    },
  },
  // ============================================================
  // baseMeals — ADDITIONAL BEEF
  // ============================================================
  {
    enName: 'Beef Stroganoff',
    et: {
      name: 'Veiseliha stroganoff',
      description: 'Kreemjas veiseliharibad seentega nuudlite peal.',
    },
  },
  {
    enName: 'Korean Beef Bowl',
    et: {
      name: 'Korea veiselihakauss',
      description: 'Magus-soolane Korea stiilis veiseliha riisi peal.',
    },
  },
  {
    enName: 'Beef Enchiladas',
    et: {
      name: "Veiseliha enchilada'd",
      description: 'Maitsestatud veiseliha ja juustutäidisega rullitud tortillad.',
    },
  },
  {
    enName: "Shepherd's Pie",
    et: {
      name: 'Karjusepirukas',
      description: 'Klassikaline veiseliha ja köögivilja pirukas kartulipüreekattega.',
    },
  },
  // ============================================================
  // baseMeals — ADDITIONAL PORK
  // ============================================================
  {
    enName: 'Honey Garlic Pork',
    et: {
      name: 'Mesi-küüslaugu seafileed',
      description: 'Pehme seafileed magusa mesi-küüslaugukattega.',
    },
  },
  {
    enName: 'Pork Lo Mein',
    et: {
      name: 'Sealiha lo mein',
      description: 'Hiina stiilis praetud nuudlid sealihaga ja köögiviljadega.',
    },
  },
  {
    enName: 'BBQ Pork Sandwich',
    et: {
      name: 'BBQ searibade võileib',
      description: 'Pehme riivitud sealiha hapu BBQ kastmega.',
    },
  },
  {
    enName: 'Pork Schnitzel',
    et: {
      name: 'Sealiha šnitsel',
      description: 'Krõbe riivsaias paneeritud seakotlet sidruniga.',
    },
  },
  // ============================================================
  // baseMeals — ADDITIONAL FISH
  // ============================================================
  {
    enName: 'Lemon Butter Cod',
    et: {
      name: 'Sidruni-võikastmes tursk',
      description: 'Pannil praetud tursk sidruni-võikastmega.',
    },
  },
  {
    enName: 'Teriyaki Salmon Bowl',
    et: {
      name: 'Teriyakilõhe kauss',
      description: 'Glaseeritud lõhe riisi peal aasia köögiviljadega.',
    },
  },
  {
    enName: 'Mediterranean Baked Fish',
    et: {
      name: 'Vahemere stiilis ahjukala',
      description: 'Ürdikoorikuga kala tomati ja oliividega.',
    },
  },
  // ============================================================
  // newMeals — BREAKFAST batch 1
  // ============================================================
  {
    enName: 'Blueberry Overnight Oats',
    et: {
      name: 'Mustika öised kaerapuder',
      description: 'Kreemjas üleöö leotatud kaer mustikatega ja meega.',
    },
  },
  {
    enName: 'Avocado Toast with Poached Egg',
    et: {
      name: 'Avokaadoröstsai pošireeritud munaga',
      description: 'Hapuniisukel leib purustatud avokaado ja pošireeritud munaga.',
    },
  },
  {
    enName: 'Greek Yogurt Parfait',
    et: {
      name: 'Kreeka jogurt granolaga',
      description: 'Kihiline jogurt granola ja marjadega.',
    },
  },
  {
    enName: 'Smoked Salmon Bagel',
    et: {
      name: 'Suitsulõhe bagel',
      description: 'Bagel toorjuustu, suitsulõhe ja kapparitega.',
    },
  },
  {
    enName: 'Breakfast Burrito',
    et: {
      name: 'Hommiku burrito',
      description: 'Munaroad ja juust soojas tortillas.',
    },
  },
  {
    enName: 'Acai Bowl',
    et: {
      name: 'Acai kauss',
      description: 'Külmutatud acai banaani, granola ja värskte puuviljadega.',
    },
  },
  {
    enName: 'Ham and Cheese Croissant',
    et: {
      name: 'Sink-juustu croissant',
      description: "Soe croissant singi ja sulanud gruyère'iga.",
    },
  },
  {
    enName: 'Eggs Benedict',
    et: {
      name: 'Eggs Benedict',
      description: "Pošireeritud munad muffini peal singi ja hollandaise'iga.",
    },
  },
  {
    enName: 'Bircher Muesli',
    et: {
      name: 'Bircher müsli',
      description: 'Šveitsi stiilis müsli õuna ja jogurtiga.',
    },
  },
  {
    enName: 'Spinach Feta Omelette',
    et: {
      name: 'Spinati-feta omlett',
      description: 'Kohev omlett spinati ja fetajuustuga.',
    },
  },
  {
    enName: 'Raspberry Chia Pudding',
    et: {
      name: 'Vaarika chia puding',
      description: 'Kreemjas chia puding värskete vaarikate ja vahtrasiirupiga.',
    },
  },
  {
    enName: 'Bacon Egg Sandwich',
    et: {
      name: 'Peekon-muna võileib',
      description: 'Krõbe peekon ja praetud muna röstsaial.',
    },
  },
  {
    enName: 'Tropical Smoothie Bowl',
    et: {
      name: 'Troopiline smuutikauss',
      description: 'Mango-ananassikauss kookoshelveste ja granolaga.',
    },
  },
  // ============================================================
  // newMeals — MORE BREAKFAST (19 more)
  // ============================================================
  {
    enName: 'Mushroom Toast',
    et: {
      name: 'Seene röstsai',
      description: 'Hautatud seened hapuniisukel leival tüümianiga.',
    },
  },
  {
    enName: 'Huevos Rancheros',
    et: {
      name: 'Huevos rancheros',
      description: 'Praetud munad tortillal salsa ja ubadega.',
    },
  },
  {
    enName: 'Chorizo Scramble',
    et: {
      name: 'Chorizo munaroad',
      description: 'Munaroad chorizo ja paprikaga.',
    },
  },
  {
    enName: 'Peanut Butter Banana Toast',
    et: {
      name: 'Maapähklivõi-banaani röstsai',
      description: 'Röstsai maapähklivõi ja banaaniviiludega.',
    },
  },
  {
    enName: 'Veggie Breakfast Hash',
    et: {
      name: 'Köögivilja hommikupann',
      description: 'Krõbedad kartulid köögiviljade ja munadega.',
    },
  },
  {
    enName: 'Ricotta Toast with Honey',
    et: {
      name: 'Ricotta röstsai meega',
      description: 'Kreemjas ricotta röstsaial mee ja kreeka pähklitega.',
    },
  },
  {
    enName: 'Sausage Breakfast Sandwich',
    et: {
      name: 'Vorsti hommikusandvitš',
      description: 'Vorstikotlet muna ja juustuga muffini peal.',
    },
  },
  {
    enName: 'Apple Cinnamon Oatmeal',
    et: {
      name: 'Õuna-kaneeli kaerapuder',
      description: 'Soe kaerapuder õuna ja kaneeliga.',
    },
  },
  {
    enName: 'Prosciutto Melon Plate',
    et: {
      name: 'Prosciutto meloniga',
      description: 'Magus melon soolase prosciuttoga mähituna.',
    },
  },
  // ============================================================
  // newMeals — POULTRY (27 new)
  // ============================================================
  {
    enName: 'Chicken Teriyaki Bowl',
    et: {
      name: 'Teriyaki kanakoivakauss',
      description: 'Glaseeritud kana riisi ja köögiviljadega.',
    },
  },
  {
    enName: 'Korean Fried Chicken',
    et: {
      name: 'Korea praekana',
      description: 'Krõbe kana gochujang glasuuriga.',
    },
  },
  {
    enName: 'Chicken Shawarma',
    et: {
      name: 'Kana shawarma',
      description: 'Maitsestatud kana küüslaugukastmega pitas.',
    },
  },
  {
    enName: 'Chicken Piccata',
    et: {
      name: 'Kana piccata',
      description: 'Pannil praetud kana sidruni-kapparikastmega.',
    },
  },
  {
    enName: 'Chicken Cacciatore',
    et: {
      name: 'Kana cacciatore',
      description: 'Hautatud kana tomati ja paprikaga.',
    },
  },
  {
    enName: 'Butter Chicken',
    et: {
      name: 'Butter chicken',
      description: 'Kreemjas tomatikarri pehme kanaga.',
    },
  },
  {
    enName: 'Chicken Marsala',
    et: {
      name: 'Kana Marsala',
      description: 'Kana marsalaveiniga seenekastmes.',
    },
  },
  {
    enName: 'Duck Breast with Orange',
    et: {
      name: 'Pardirinnatükk apelsiniga',
      description: 'Pannil praetud pardirinnatükk apelsiniglasuuri.',
    },
  },
  {
    enName: 'Chicken Satay',
    et: {
      name: 'Kana satay',
      description: 'Grillitud kanavarras maapähklikastmega.',
    },
  },
  {
    enName: 'Lemon Herb Roast Chicken',
    et: {
      name: 'Sidruni-ürtide ahjukana',
      description: 'Ahjus küpsetatud kana sidruni ja ürtidega.',
    },
  },
  {
    enName: 'Chicken Quesadilla',
    et: {
      name: 'Kana quesadilla',
      description: 'Krõbe tortilla kana ja sulanud juustuga.',
    },
  },
  {
    enName: 'Turkey Burger',
    et: {
      name: 'Kalkuniburger',
      description: 'Lahja kalkuni kotlet värskete lisanditega.',
    },
  },
  {
    enName: 'Chicken Pho',
    et: {
      name: 'Kana pho',
      description: 'Vietnami nuudlisupp kanaga.',
    },
  },
  // ============================================================
  // newMeals — BEEF (20 new)
  // ============================================================
  {
    enName: 'Korean Beef Bulgogi',
    et: {
      name: 'Bulgogi',
      description: 'Marineeritud viilutatud veiseliha seesamiga ja rohkete sibularohega.',
    },
  },
  {
    enName: 'Beef Pho',
    et: {
      name: 'Veiseliha pho',
      description: 'Vietnami nuudlisupp harva küpsetatud veiselihaga.',
    },
  },
  {
    enName: 'Steak Frites',
    et: {
      name: 'Steak frites',
      description: 'Pannil praetud steik krõbedate friikartulitega.',
    },
  },
  {
    enName: 'Beef Burritos',
    et: {
      name: 'Veiseliha burritod',
      description: 'Maitsestatud veiseliha riisi ja ubadega tortillas.',
    },
  },
  {
    enName: 'Beef Rendang',
    et: {
      name: 'Beef rendang',
      description: 'Indoneesia aeglaselt hautatud vürtsikas veiseliha.',
    },
  },
  {
    enName: 'Meatball Subs',
    et: {
      name: 'Lihapalli võileib',
      description: 'Veiseliha lihapallid marinara kastmega krõbedas saiakeses.',
    },
  },
  {
    enName: 'Beef Bibimbap',
    et: {
      name: 'Bibimbap',
      description: 'Korea riisikauss veiseliha ja köögiviljadega.',
    },
  },
  {
    enName: 'Cottage Pie',
    et: {
      name: 'Cottage pie',
      description: 'Veiselihahakkliha kreemja kartulipüreekattega.',
    },
  },
  // ============================================================
  // newMeals — PORK (16 new)
  // ============================================================
  {
    enName: 'Pork Tonkatsu',
    et: {
      name: 'Tonkatsu',
      description: 'Jaapani riivsaias paneeritud seakotlet riisiga.',
    },
  },
  {
    enName: 'Char Siu Pork',
    et: {
      name: 'Char siu',
      description: 'Hiina BBQ glasuuriga sea abaliha.',
    },
  },
  {
    enName: 'Pulled Pork Tacos',
    et: {
      name: 'Pulled pork tacod',
      description: 'Aeglaselt küpsetatud riivitud sealiha pehmes tacod.',
    },
  },
  {
    enName: 'Pork Ramen',
    et: {
      name: 'Sealiha ramen',
      description: 'Rikkalik sealiha puljong nuudlite ja munaga.',
    },
  },
  {
    enName: 'Pork Carnitas Bowl',
    et: {
      name: 'Carnitas kauss',
      description: 'Mehhiko hautatud sealiha riisi ja ubadega.',
    },
  },
  {
    enName: 'Sausage and Peppers',
    et: {
      name: 'Vorst paprikatega',
      description: 'Itaalia vorst praetud paprikate ja sibulaga.',
    },
  },
  {
    enName: 'Pork Stir-Fry with Cashews',
    et: {
      name: 'Sealiha wok india pähklitega',
      description: 'Kiire sealiha wok india pähklitega.',
    },
  },
  {
    enName: 'BLT Sandwich',
    et: {
      name: 'BLT võileib',
      description: 'Klassikaline peekon-salat-tomat võileib.',
    },
  },
  {
    enName: 'Pancetta Carbonara',
    et: {
      name: 'Carbonara',
      description: 'Klassikaline Rooma pasta pancetta ja munaga.',
    },
  },
  // ============================================================
  // newMeals — LAMB (18 new)
  // ============================================================
  {
    enName: 'Lamb Kofta',
    et: {
      name: 'Lambaliha kofta',
      description: 'Vürtsitatud lambalihavarrased jogurtikastmega.',
    },
  },
  {
    enName: 'Lamb Tagine',
    et: {
      name: 'Lambaliha tagiin',
      description: 'Maroko lambahautis aprikooside ja kuskussiga.',
    },
  },
  {
    enName: 'Greek Lamb Chops',
    et: {
      name: 'Kreeka lambakotletid',
      description: "Grillitud lambakotletid sidruni ja pune'ga.",
    },
  },
  {
    enName: 'Lamb Shawarma',
    et: {
      name: 'Lambaliha shawarma',
      description: "Maitsestatud lambaliha pitas tahini'ga.",
    },
  },
  {
    enName: 'Irish Lamb Stew',
    et: {
      name: 'Iiri lambahautis',
      description: 'Rammus lambaliha ja kartuli hautis.',
    },
  },
  {
    enName: 'Lamb Moussaka',
    et: {
      name: 'Moussaka',
      description: 'Kreeka kihiline lambaliha ja baklažaanivorm.',
    },
  },
  {
    enName: 'Lamb Rogan Josh',
    et: {
      name: 'Rogan josh',
      description: 'Kashmiri lambaliha aromaatses punases kastmes.',
    },
  },
  {
    enName: 'Lamb Gyros',
    et: {
      name: 'Lambaliha gyros',
      description: 'Kreeka lambaliha wrap tzatzikiga.',
    },
  },
  {
    enName: 'Lamb Meatballs',
    et: {
      name: 'Lambaliha lihapallid',
      description: 'Vahemere stiilis lambaliha lihapallid mündi ja kuskussiga.',
    },
  },
  // ============================================================
  // newMeals — FISH & SEAFOOD (24 new)
  // ============================================================
  {
    enName: 'Garlic Butter Shrimp',
    et: {
      name: 'Küüslaugu-või krevetid',
      description: 'Pannil praetud krevetid küüslaugu-võikastmega.',
    },
  },
  {
    enName: 'Thai Fish Curry',
    et: {
      name: 'Tai kalakarri',
      description: 'Valge kala lõhnavas Tai karrikastmes.',
    },
  },
  {
    enName: 'Seared Scallops',
    et: {
      name: 'Praetud kammkarbid',
      description: 'Pannil pruunistatud kammkarbid pruuni võiga.',
    },
  },
  {
    enName: 'Miso Glazed Salmon',
    et: {
      name: 'Miso-glasuuriga lõhe',
      description: 'Ahjus küpsetatud lõhe magusa miso glasuuriga.',
    },
  },
  {
    enName: 'Seafood Paella',
    et: {
      name: 'Mereandide paella',
      description: 'Hispaania riis segamereandidega.',
    },
  },
  {
    enName: 'Crab Cakes',
    et: {
      name: 'Krabikoogid',
      description: "Pannil praetud krabikoogid sidruni aioli'ga.",
    },
  },
  {
    enName: 'Grilled Sea Bass',
    et: {
      name: 'Grillitud meriahven',
      description: 'Terve grillitud meriahven ürtidega.',
    },
  },
  {
    enName: 'Tuna Poke Bowl',
    et: {
      name: 'Tuunikala poke kauss',
      description: 'Havai toore tuunikala kauss riisiga.',
    },
  },
  {
    enName: 'Shrimp Pad Thai',
    et: {
      name: 'Kreveti Pad Thai',
      description: 'Tai praetud nuudlid krevetitega.',
    },
  },
  {
    enName: 'Fish Tacos',
    et: {
      name: 'Kala tacod',
      description: 'Krõbe kala maisitortilladel kapsakoleslaaga.',
    },
  },
  {
    enName: 'Linguine alle Vongole',
    et: {
      name: 'Linguine alle vongole',
      description: 'Itaalia pasta rannakarbiga ja valge veiniga.',
    },
  },
  {
    enName: 'Trout with Almonds',
    et: {
      name: 'Forell mandlitega',
      description: 'Pannil praetud forell röstitud mandlitega.',
    },
  },
  // ============================================================
  // newMeals — LEGUMES (22 new)
  // ============================================================
  {
    enName: 'Chickpea Tikka Masala',
    et: {
      name: 'Kikerherned tikka masala',
      description: 'Kikerherned kreemjas tomati karrikastmes.',
    },
  },
  {
    enName: 'Falafel Wrap',
    et: {
      name: 'Falafel wrap',
      description: "Krõbe falafel pitas tahini'ga.",
    },
  },
  {
    enName: 'Dal Tadka',
    et: {
      name: 'Dal tadka',
      description: 'India vürtsitatud kollased läätsed.',
    },
  },
  {
    enName: 'Three Bean Chili',
    et: {
      name: 'Kolme oa chili',
      description: 'Rammus taimetoitlane oa chili.',
    },
  },
  {
    enName: 'Mapo Tofu',
    et: {
      name: 'Mapo tofu',
      description: 'Sichuan vürtsikas tofu sealihaga.',
    },
  },
  {
    enName: 'Hummus Bowl',
    et: {
      name: 'Hummuskauss',
      description: 'Kreemjas hummus köögiviljade ja pita leivaga.',
    },
  },
  // ============================================================
  // newMeals — VEGETARIAN (30 new)
  // ============================================================
  {
    enName: 'Vegetable Pad Thai',
    et: {
      name: 'Köögivilja Pad Thai munaga',
      description: 'Tai nuudlid köögiviljade ja maapähklitega.',
    },
  },
  {
    enName: 'Grilled Halloumi Salad',
    et: {
      name: 'Grillitud haloumi salat',
      description: 'Soe haloumi värskel salatilaual.',
    },
  },
  {
    enName: 'Spinach and Ricotta Stuffed Shells',
    et: {
      name: 'Spinati-ricotta täidetud pastakoored',
      description: 'Pastakoored kreemja täidisega.',
    },
  },
  {
    enName: 'Paneer Tikka',
    et: {
      name: 'Paneer tikka',
      description: 'Grillitud maitsestatud paneer varrastel.',
    },
  },
  {
    enName: 'Eggplant Parmesan',
    et: {
      name: 'Baklažaan parmesan',
      description: 'Paneeritud baklažaan marinara kastme ja juustuga.',
    },
  },
  {
    enName: 'Vegetable Curry',
    et: {
      name: 'Köögiviljadekarri',
      description: 'Segaköögiviljad aromaatses karrikastmes.',
    },
  },
  {
    enName: 'Margherita Pizza',
    et: {
      name: 'Margherita pitsa',
      description: 'Klassikaline pitsa tomati, mozzarella ja basiilikuga.',
    },
  },
  {
    enName: 'Goat Cheese Beet Salad',
    et: {
      name: 'Kitsepiimajuustu-peedi salat',
      description: 'Röstitud peet kitsepiimajuustu ja kreeka pähklitega.',
    },
  },
  {
    enName: 'Gnocchi with Sage Butter',
    et: {
      name: 'Gnocchi salvei võiga',
      description: 'Pehmed kartuli gnocchi pruuni salvei võiga.',
    },
  },
  // ============================================================
  // newMeals — QUICK (15 more)
  // ============================================================
  {
    enName: 'Tuna Salad Sandwich',
    et: {
      name: 'Tuunikala salati võileib',
      description: 'Klassikaline tuunikala salat leival.',
    },
  },
  {
    enName: 'Cheese Omelette',
    et: {
      name: 'Juustu omlett',
      description: 'Lihtne kohev juustu omlett.',
    },
  },
  {
    enName: 'Grilled Cheese Sandwich',
    et: {
      name: 'Grillitud juustuvõileib',
      description: 'Krõbe võiga küpsetatud juustuvõileib.',
    },
  },
  {
    enName: 'Caprese Panini',
    et: {
      name: 'Caprese panini',
      description: 'Röstitud võileib tomati ja mozzarellaga.',
    },
  },
  {
    enName: 'Fish Fingers with Mash',
    et: {
      name: 'Kalapulgad kartulipüreega',
      description: 'Krõbedad kalapulgad kartulipüree ja hernestega.',
    },
  },
  {
    enName: 'Quick Chicken Salad',
    et: {
      name: 'Kiire kanasalat',
      description: 'Grillitud kanafilee segalatil.',
    },
  },
  {
    enName: 'Spaghetti Aglio e Olio',
    et: {
      name: 'Spaghetti aglio e olio',
      description: 'Lihtne pasta küüslaugu ja oliiviõliga.',
    },
  },
  // ============================================================
  // newMeals — ASIAN (20 more)
  // ============================================================
  {
    enName: 'Beef Udon',
    et: {
      name: 'Veiseliha udon',
      description: 'Jaapani nuudlisupp viilutatud veiselihaga.',
    },
  },
  {
    enName: 'Chicken Katsu Curry',
    et: {
      name: 'Kana katsu karri',
      description: 'Jaapani karri paneeritud kanaga.',
    },
  },
  {
    enName: 'Vietnamese Spring Rolls',
    et: {
      name: 'Vietnami kevadrullid',
      description: 'Värsked riisipaberirullid krevetitega.',
    },
  },
  {
    enName: 'Miso Soup with Tofu',
    et: {
      name: 'Miso supp tofuga',
      description: 'Traditsiooniline Jaapani miso supp.',
    },
  },
  {
    enName: 'Kung Pao Chicken',
    et: {
      name: 'Kung Pao kana',
      description: 'Sichuan vürtsikas kana maapähklitega.',
    },
  },
  {
    enName: 'Japanese Gyudon',
    et: {
      name: 'Gyudon',
      description: 'Jaapani veiseliha riisikauss sibulaga.',
    },
  },
  {
    enName: 'Pork Gyoza',
    et: {
      name: 'Sealiha gyoza',
      description: 'Pannil praetud Jaapani pelmeenid.',
    },
  },
  {
    enName: 'Shrimp Laksa',
    et: {
      name: 'Kreveti laksa',
      description: 'Malaisia kookospiima karri nuudlisupina.',
    },
  },
  {
    enName: 'Beef Japchae',
    et: {
      name: 'Japchae',
      description: 'Korea klaasist nuudlid veiselihaga.',
    },
  },
  // ============================================================
  // newMeals — MEDITERRANEAN (15 more)
  // ============================================================
  {
    enName: 'Lamb Souvlaki',
    et: {
      name: 'Lambaliha souvlaki',
      description: 'Kreeka lambaliha varrased tzatzikiga.',
    },
  },
  {
    enName: 'Shakshuka with Feta',
    et: {
      name: 'Shakshuka fetaga',
      description: 'Munad pošireeritud vürtsika tomatikastme sees fetaga.',
    },
  },
  {
    enName: 'Chicken Souvlaki',
    et: {
      name: 'Kana souvlaki',
      description: 'Kreeka kana varrased sidruniga.',
    },
  },
  {
    enName: 'Fattoush Salad',
    et: {
      name: 'Fattoush salat',
      description: 'Liibanoni salat krõbeda pita leivaga.',
    },
  },
  {
    enName: 'Grilled Sardines',
    et: {
      name: 'Grillitud sardiinid',
      description: 'Vahemere stiilis grillitud sardiinid sidruniga.',
    },
  },
  {
    enName: 'Baked Feta Pasta',
    et: {
      name: 'Ahjufeta pasta',
      description: 'Ahjus küpsetatud feta kirsstomatitega pasta.',
    },
  },
  {
    enName: 'Lamb Pita Pockets',
    et: {
      name: 'Lambaliha pita taskud',
      description: 'Vürtsitatud lambaliha soojas pitas.',
    },
  },
  {
    enName: 'Za atar Chicken',
    et: {
      name: "Za'atar kana",
      description: "Ahjus küpsetatud kana za'atar vürtsiga.",
    },
  },
  // ============================================================
  // newMeals — COMFORT FOOD (15 more)
  // ============================================================
  {
    enName: 'Classic Lasagna',
    et: {
      name: 'Klassikaline lasanje',
      description: 'Kihiline pasta lihakastme ja juustuga.',
    },
  },
  {
    enName: 'Chicken Pot Pie',
    et: {
      name: 'Kana ahjupasteet',
      description: 'Kreemjas kana ja köögiviljad taigna all.',
    },
  },
  {
    enName: 'Beef Pot Roast',
    et: {
      name: 'Hautatud veiseliha',
      description: 'Aeglaselt hautatud veiseliha köögiviljadega.',
    },
  },
  {
    enName: 'Creamy Chicken Alfredo',
    et: {
      name: 'Kana Alfredo pasta',
      description: 'Fettuccine kanaga kreemjas Alfredo kastmes.',
    },
  },
  {
    enName: 'Meatloaf',
    et: {
      name: 'Hakklihavorm',
      description: 'Klassikaline veiseliha hakklihavorm glasuuriga.',
    },
  },
  {
    enName: 'Pork and Apple',
    et: {
      name: 'Seakotletid õuna ja salveiga',
      description: 'Seakotletid karamelliseeritud õuna ja salveiga.',
    },
  },
  {
    enName: 'Shepherd s Pie',
    et: {
      name: 'Lambakarjusepirukas',
      description: 'Lambalihahakkliha kartulipüreekattega.',
    },
  },
  {
    enName: 'Chicken Fried Steak',
    et: {
      name: 'Paneeritud veiseliha kreemikastmega',
      description: 'Riivsaias paneeritud veiseliha kreemise karrikastmega.',
    },
  },
  {
    enName: 'BBQ Pulled Pork',
    et: {
      name: 'BBQ pulled pork',
      description: 'Aeglaselt küpsetatud riivitud sealiha BBQ kastmega.',
    },
  },
  {
    enName: 'Honey Garlic Salmon',
    et: {
      name: 'Mesi-küüslauguga lõhe',
      description: 'Glaseeritud lõhe mee ja küüslauguga.',
    },
  },
  // ============================================================
  // newMeals — MORE VARIETY (25 more)
  // ============================================================
  {
    enName: 'Beef Chili',
    et: {
      name: 'Veiseliha chili',
      description: 'Rammus veiseliha chili ubadega.',
    },
  },
  {
    enName: 'Chicken Wings',
    et: {
      name: 'Kanatiivad',
      description: 'Krõbedad ahjus küpsetatud kanatiivad.',
    },
  },
  {
    enName: 'Penne Arrabbiata',
    et: {
      name: 'Penne arrabbiata',
      description: 'Vürtsikas tomatipasta.',
    },
  },
  {
    enName: 'Salmon Caesar Salad',
    et: {
      name: 'Lõhe Caesari salat',
      description: 'Grillitud lõhe Caesari salatil.',
    },
  },
  {
    enName: 'Coconut Shrimp',
    et: {
      name: 'Kookoskrevetid',
      description: 'Krõbedad kookoshelveste kattega krevetid.',
    },
  },
  {
    enName: 'Pork Fried Noodles',
    et: {
      name: 'Sealiha praetud nuudlid',
      description: 'Praetud nuudlid sealihaga.',
    },
  },
  {
    enName: 'Lamb Kofta Wrap',
    et: {
      name: 'Lambaliha kofta wrap',
      description: 'Vürtsitatud lambaliha kofta lameleivas.',
    },
  },
  {
    enName: 'Vegetable Lasagna',
    et: {
      name: 'Köögivilja lasanje',
      description: 'Kihiline pasta köögiviljadega.',
    },
  },
  {
    enName: 'Teriyaki Salmon',
    et: {
      name: 'Teriyakilõhe',
      description: 'Glaseeritud lõhe teriyakikastmega.',
    },
  },
  {
    enName: 'Black Pepper Beef',
    et: {
      name: 'Musta pipra veiseliha',
      description: 'Wokis praetud veiseliha musta pipraga.',
    },
  },
  {
    enName: 'Spinach Artichoke Pasta',
    et: {
      name: 'Spinati-artišoki pasta',
      description: 'Kreemjas pasta spinati ja artišokiga.',
    },
  },
  {
    enName: 'Honey Lemon Chicken',
    et: {
      name: 'Mesi-sidruni kana',
      description: 'Pannil praetud kana mesi-sidruni glasuuriga.',
    },
  },
  {
    enName: 'Veggie Burrito Bowl',
    et: {
      name: 'Köögivilja burritokauss',
      description: 'Burritokauss ubade ja köögiviljadega.',
    },
  },
  {
    enName: 'Garlic Butter Steak',
    et: {
      name: 'Küüslaugu-võisteik',
      description: 'Pannil praetud steik küüslaugu-võiga.',
    },
  },
  // ============================================================
  // newMeals — FINAL BATCH (42 more)
  // ============================================================
  {
    enName: 'Mackerel with Potatoes',
    et: {
      name: 'Makrell kartulitega',
      description: 'Grillitud makrell röstitud kartulitega.',
    },
  },
  {
    enName: 'Lobster Tail',
    et: {
      name: 'Homari saba',
      description: 'Võis hautatud homari saba.',
    },
  },
  {
    enName: 'Lamb Rack',
    et: {
      name: 'Lambaseljatükk ürdikoorikuga',
      description: 'Ürdikoorikuga ahjus küpsetatud lambakülg.',
    },
  },
  {
    enName: 'Pork Banh Mi',
    et: {
      name: 'Sealiha bánh mì',
      description: 'Vietnami võileib sealihaga.',
    },
  },
  {
    enName: 'Chicken Korma',
    et: {
      name: 'Kana korma',
      description: 'Pehme ja kreemjas kanakarri.',
    },
  },
  {
    enName: 'Beef Bourguignon',
    et: {
      name: 'Beef bourguignon',
      description: 'Prantsuse veiselihahautis punase veiniga.',
    },
  },
  {
    enName: 'Spicy Tofu Bowl',
    et: {
      name: 'Vürtsikas tofukauss',
      description: 'Krõbe tofu gochujang kastmega riisi peal.',
    },
  },
  {
    enName: 'Lamb Biryani',
    et: {
      name: 'Lambaliha biryani',
      description: 'Lõhnavas vürtsiriis lambaliha.',
    },
  },
  {
    enName: 'Chicken Adobo',
    et: {
      name: 'Kana adobo',
      description: 'Filipiini hautatud kana äädikas.',
    },
  },
  {
    enName: 'Sausage Pasta',
    et: {
      name: 'Vorsti pasta',
      description: 'Pasta Itaalia vorsti ja tomatitega.',
    },
  },
  {
    enName: 'Feta Stuffed Chicken',
    et: {
      name: 'Feta täidisega kanafilee',
      description: 'Kanafilee täidetud feta ja spinatiga.',
    },
  },
  {
    enName: 'Prawn Risotto',
    et: {
      name: 'Krevetite risotto',
      description: 'Kreemjas risotto krevetitega.',
    },
  },
  {
    enName: 'Vegetable Frittata',
    et: {
      name: 'Köögivilja frittata',
      description: 'Itaalia munaroog köögiviljadega.',
    },
  },
  {
    enName: 'Chicken Jambalaya',
    et: {
      name: 'Kana jambalaya',
      description: 'Cajun stiilis riis kana ja vorstiga.',
    },
  },
  {
    enName: 'Beef Kofta',
    et: {
      name: 'Veiseliha kofta',
      description: 'Lähis-Ida maitsestatud veiselihavarrased.',
    },
  },
  {
    enName: 'Mussels in White Wine',
    et: {
      name: 'Rannakarbid valges veinis',
      description: 'Aurutatud rannakarbid küüslaugu ja veiniga.',
    },
  },
  {
    enName: 'Roasted Pork Belly',
    et: {
      name: 'Ahjus küpsetatud searasv',
      description: 'Krõbeda nahaga ahjus küpsetatud sea kõhuliha.',
    },
  },
  {
    enName: 'Halibut with Pesto',
    et: {
      name: 'Hiidlest pestoga',
      description: 'Pannil praetud hiidlest basiilikupestoga.',
    },
  },
  {
    enName: 'Bean and Cheese Quesadilla',
    et: {
      name: 'Oa-juustu quesadilla',
      description: 'Musta oa ja juustu quesadilla.',
    },
  },
  {
    enName: 'Pork Larb',
    et: {
      name: 'Sealiha larb',
      description: 'Tai hakitud sealiha salat.',
    },
  },
  {
    enName: 'Stuffed Mushrooms',
    et: {
      name: 'Täidetud seened',
      description: 'Seened täidetud juustu ja ürtidega.',
    },
  },
  {
    enName: 'Chicken Enchiladas',
    et: {
      name: "Kana enchilada'd",
      description: 'Kana rullitud tortilladesse tomatikastmega.',
    },
  },
  {
    enName: 'Seafood Chowder',
    et: {
      name: 'Mereandide chowder',
      description: 'Kreemjas supp segamereandidega.',
    },
  },
  {
    enName: 'Tofu Pad Thai',
    et: {
      name: 'Tofu Pad Thai',
      description: 'Tai nuudlid krõbeda tofuga.',
    },
  },
  {
    enName: 'Salmon Teriyaki Bowl',
    et: {
      name: 'Lõhe teriyaki kauss',
      description: 'Teriyakilõhe riisi peal.',
    },
  },
  {
    enName: 'Beef Empanadas',
    et: {
      name: "Veiseliha empanada'd",
      description: 'Maitseka veiselihatäidisega küpsetised.',
    },
  },
  {
    enName: 'Lemon Sole',
    et: {
      name: 'Sidruni merikeele',
      description: 'Pannil praetud merikeele sidruni-võiga.',
    },
  },
  {
    enName: 'Lamb Pilaf',
    et: {
      name: 'Lambaliha pilaff',
      description: 'Lähis-Ida riis lambalihaga.',
    },
  },
  {
    enName: 'Creamy Polenta with Mushrooms',
    et: {
      name: 'Kreemjas polenta seentega',
      description: 'Pehme polenta praetud seentega.',
    },
  },
  {
    enName: 'Tilapia with Mango Salsa',
    et: {
      name: 'Tilapia mango salsaga',
      description: 'Grillitud tilapia värske mango salsaga.',
    },
  },
  {
    enName: 'Duck Fried Rice',
    et: {
      name: 'Parti praetud riis',
      description: 'Praetud riis hakitud pardiribadega.',
    },
  },
  {
    enName: 'Squid Stir-Fry',
    et: {
      name: 'Kalmaar wokis',
      description: 'Kiiresti wokis praetud kalmaar köögiviljadega.',
    },
  },
  {
    enName: 'Mediterranean Quinoa Bowl',
    et: {
      name: 'Vahemere kinoakauss',
      description: 'Kinoa köögiviljade ja fetaga.',
    },
  },
  {
    enName: 'Pork Milanese',
    et: {
      name: 'Sealiha Milanese',
      description: 'Paneeritud seakotlet rukolaga.',
    },
  },
  {
    enName: 'Sweet and Sour Pork',
    et: {
      name: 'Magus-hapu sealiha',
      description: 'Klassikaline Hiina magus-hapu sealiha.',
    },
  },
]
