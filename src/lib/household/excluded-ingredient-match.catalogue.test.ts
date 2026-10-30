import { describe, expect, it } from 'vitest'

import { ingredientTranslationsEt } from '../../../prisma/seed-ingredient-translations-et'
import { type ExclusionPoolRow, matchTags } from './excluded-ingredient-match'

// The Estonian part-of-word rule (HON-1477) over the seeded Estonian names.
// The expected names are literals from the issue, not read from the tables.

const POOL: ExclusionPoolRow[] = ingredientTranslationsEt.map((t) => ({
  id: t.en,
  name: t.en,
  householdId: null,
  translations: [{ locale: 'et', name: t.et }],
}))

const estonianNames = (tag: string) =>
  matchTags([tag], POOL, 'et')[0]?.ingredients.map((i) => i.name) ?? []

describe('matchTags over the seeded Estonian names', () => {
  it.each([
    ['kana', ['kanafilee', 'kanatiib', 'kanamaks', 'kanapuljong', 'pelmeenid kanalihaga']],
    ['liha', ['veisehakkliha', 'seahakkliha', 'vasikaliha', 'hirveliha', 'krabiliha']],
    ['riis', ['basmatiriis', 'riisijahu', 'riisinuudlid']],
    ['nisu', ['nisujahu', 'speltanisu']],
    ['soja', ['sojakaste', 'sojapiim', 'sojaoad']],
    ['seesam', ['seesamiõli', 'seesamiseemned']],
    ['hernes', ['herned', 'suhkruherned']],
    ['herned', ['herned', 'suhkruherned']],
    ['koor', ['vahukoor', 'hapukoor']],
    ['lammas', ['lambahakkliha', 'lambakotlet']],
    ['part', ['pardirind', 'pardirasv']],
    ['mandel', ['mandlid', 'mandlijahu', 'mandlipiim']],
    ['maapähkel', ['maapähkliõli', 'maapähklivõi']],
    ['kurgid', ['kurk']],
    ['küüslaugud', ['küüslauk', 'küüslaugupulber']],
    ['mari', ['mustikas', 'maasikas', 'vaarikas', 'karusmari']],
    ['marjad', ['mustikas', 'maasikas', 'vaarikas', 'karusmari']],
    ['brokoli', ['brokoli', 'hiina brokoli']],
    ['brokkoli', ['brokoli', 'hiina brokoli']],
    ['lillkapsas', ['lillkapsas', 'külmutatud brokoli-lillkapsasegu']],
    ['pasta', ['pasta', 'täisterapasta']],
    ['till', ['till', 'kuivatatud till']],
    ['kirss', ['kirss']],
    ['ploom', ['ploom', 'kuivatatud ploomid']],
  ])('"%s" excludes %j', (tag, expected) => {
    expect(estonianNames(tag)).toEqual(expect.arrayContaining(expected))
  })

  it.each([
    ['liha', ['kookosviljaliha']],
    ['soja', ['kookosesoja']],
    ['hernes', ['kikerherned']],
    ['herned', ['kikerherned']],
    ['koor', ['kooritud krevetid', 'tofukoor']],
    ['lammas', ['põld-lambalääts', 'kuivatatud lambaläätse lehed']],
    ['mari', ['viinamarjad', 'rosmariin', 'tamari']],
    ['marjad', ['viinamarjad', 'rosmariin', 'tamari']],
    ['kurk', ['kurkum']],
    ['jahu', ['jahubanaan']],
    ['sidrun', ['sidrunhein']],
    ['tomat', ['tomatillo']],
    ['tomatid', ['tomatillo']],
    ['kanad', ['pärlkana']],
    ['lambad', ['põld-lambalääts']],
    ['pastad', ['tomatipasta', 'karripasta', 'misopasta']],
    ['till', ['tortilla', 'maisitortilla', 'nisutortilla', 'tomatillo', 'apteegitill']],
    ['kook', ['kookoshelbed', 'kookospiim']],
    ['kirss', ['kirsstomatid', 'ploomkirsstomat']],
    ['ploom', ['ploomitomat', 'konserveeritud kooritud terved tomatid']],
    ['sidrun', ['sidruntüümian', 'sidrunverbena']],
    ['rõigas', ['mädarõigas']],
    ['salat', ['itaalia salatikaste']],
    ['kõrvits', ['kõrvitsapiruka vürtsisegu']],
    ['läätsed', ['kuivatatud lambaläätse lehed']],
    ['sinep', ['sinepilehed']],
    ['sool', ['kapparid soolvees']],
    ['pirn', ['maapirn']],
    ['õunad', ['granaatõun', 'granaatõunamelass']],
    ['banaan', ['banaanipaprika']],
    ['tatar', ['tatarikaste']],
    ['pähkel', ['muskaatpähkel']],
    ['kala', ['kalamata oliiv']],
    ['pasta', ['tomatipasta', 'karripasta', 'misopasta', 'mole pasta']],
  ])('"%s" does not exclude %j', (tag, unexpected) => {
    const found = estonianNames(tag)
    for (const name of unexpected) expect(found).not.toContain(name)
  })
})
