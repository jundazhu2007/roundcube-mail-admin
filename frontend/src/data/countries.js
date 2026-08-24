// 依洲別分組的國家清單（ISO 3166-1 alpha-2），只給 Webmail 國家限制頁面選取用。
// 國名一律用英文（跨語言介面下維持一致、避免要維護三份翻譯），配合 flag emoji + 代碼辨識。
export const CONTINENTS = [
  {
    key: 'asia',
    labelKey: 'continents.asia',
    countries: [
      ['JP', 'Japan'], ['TW', 'Taiwan'], ['CN', 'China'], ['HK', 'Hong Kong'], ['MO', 'Macau'],
      ['KR', 'South Korea'], ['KP', 'North Korea'], ['SG', 'Singapore'], ['MY', 'Malaysia'],
      ['TH', 'Thailand'], ['VN', 'Vietnam'], ['PH', 'Philippines'], ['ID', 'Indonesia'],
      ['IN', 'India'], ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['LK', 'Sri Lanka'],
      ['MM', 'Myanmar'], ['KH', 'Cambodia'], ['LA', 'Laos'], ['MN', 'Mongolia'],
      ['NP', 'Nepal'], ['BT', 'Bhutan'], ['BN', 'Brunei'], ['TL', 'Timor-Leste'],
      ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'], ['IL', 'Israel'], ['TR', 'Turkey'],
      ['IR', 'Iran'], ['IQ', 'Iraq'], ['JO', 'Jordan'], ['LB', 'Lebanon'], ['SY', 'Syria'],
      ['YE', 'Yemen'], ['OM', 'Oman'], ['QA', 'Qatar'], ['KW', 'Kuwait'], ['BH', 'Bahrain'],
      ['AF', 'Afghanistan'], ['KZ', 'Kazakhstan'], ['UZ', 'Uzbekistan'], ['TM', 'Turkmenistan'],
      ['KG', 'Kyrgyzstan'], ['TJ', 'Tajikistan'], ['AZ', 'Azerbaijan'], ['GE', 'Georgia'], ['AM', 'Armenia'],
    ],
  },
  {
    key: 'europe',
    labelKey: 'continents.europe',
    countries: [
      ['GB', 'United Kingdom'], ['DE', 'Germany'], ['FR', 'France'], ['IT', 'Italy'], ['ES', 'Spain'],
      ['PT', 'Portugal'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['CH', 'Switzerland'], ['AT', 'Austria'],
      ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['IS', 'Iceland'],
      ['IE', 'Ireland'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['SK', 'Slovakia'], ['HU', 'Hungary'],
      ['RO', 'Romania'], ['BG', 'Bulgaria'], ['GR', 'Greece'], ['UA', 'Ukraine'], ['BY', 'Belarus'],
      ['RU', 'Russia'], ['MD', 'Moldova'], ['LT', 'Lithuania'], ['LV', 'Latvia'], ['EE', 'Estonia'],
      ['HR', 'Croatia'], ['SI', 'Slovenia'], ['RS', 'Serbia'], ['BA', 'Bosnia and Herzegovina'],
      ['ME', 'Montenegro'], ['MK', 'North Macedonia'], ['AL', 'Albania'], ['XK', 'Kosovo'],
      ['LU', 'Luxembourg'], ['MT', 'Malta'], ['CY', 'Cyprus'], ['AD', 'Andorra'], ['MC', 'Monaco'],
      ['LI', 'Liechtenstein'], ['SM', 'San Marino'], ['VA', 'Vatican City'],
    ],
  },
  {
    key: 'northAmerica',
    labelKey: 'continents.northAmerica',
    countries: [
      ['US', 'United States'], ['CA', 'Canada'], ['MX', 'Mexico'],
    ],
  },
  {
    key: 'otherAmericas',
    labelKey: 'continents.otherAmericas',
    countries: [
      ['BR', 'Brazil'], ['AR', 'Argentina'], ['CL', 'Chile'], ['CO', 'Colombia'], ['PE', 'Peru'],
      ['VE', 'Venezuela'], ['EC', 'Ecuador'], ['BO', 'Bolivia'], ['PY', 'Paraguay'], ['UY', 'Uruguay'],
      ['GY', 'Guyana'], ['SR', 'Suriname'],
      ['CU', 'Cuba'], ['DO', 'Dominican Republic'], ['HT', 'Haiti'], ['JM', 'Jamaica'],
      ['PA', 'Panama'], ['CR', 'Costa Rica'], ['NI', 'Nicaragua'], ['HN', 'Honduras'],
      ['GT', 'Guatemala'], ['SV', 'El Salvador'], ['BZ', 'Belize'], ['TT', 'Trinidad and Tobago'],
      ['BS', 'Bahamas'], ['BB', 'Barbados'],
    ],
  },
  {
    key: 'africa',
    labelKey: 'continents.africa',
    countries: [
      ['EG', 'Egypt'], ['ZA', 'South Africa'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['ET', 'Ethiopia'],
      ['GH', 'Ghana'], ['TZ', 'Tanzania'], ['UG', 'Uganda'], ['DZ', 'Algeria'], ['MA', 'Morocco'],
      ['TN', 'Tunisia'], ['LY', 'Libya'], ['SD', 'Sudan'], ['SN', 'Senegal'], ['CI', "Cote d'Ivoire"],
      ['CM', 'Cameroon'], ['ZW', 'Zimbabwe'], ['ZM', 'Zambia'], ['MZ', 'Mozambique'], ['AO', 'Angola'],
      ['MG', 'Madagascar'], ['CD', 'DR Congo'], ['CG', 'Congo'], ['RW', 'Rwanda'], ['SO', 'Somalia'],
      ['NA', 'Namibia'], ['BW', 'Botswana'], ['ML', 'Mali'], ['NE', 'Niger'], ['BF', 'Burkina Faso'],
      ['MW', 'Malawi'], ['MU', 'Mauritius'], ['BJ', 'Benin'], ['TG', 'Togo'], ['LR', 'Liberia'],
      ['SL', 'Sierra Leone'], ['GN', 'Guinea'], ['GM', 'Gambia'], ['GA', 'Gabon'], ['ER', 'Eritrea'],
      ['DJ', 'Djibouti'], ['SS', 'South Sudan'], ['LS', 'Lesotho'], ['SZ', 'Eswatini'],
    ],
  },
  {
    key: 'oceania',
    labelKey: 'continents.oceania',
    countries: [
      ['AU', 'Australia'], ['NZ', 'New Zealand'], ['FJ', 'Fiji'], ['PG', 'Papua New Guinea'],
      ['NC', 'New Caledonia'], ['SB', 'Solomon Islands'], ['VU', 'Vanuatu'], ['WS', 'Samoa'],
      ['TO', 'Tonga'], ['GU', 'Guam'], ['PF', 'French Polynesia'],
    ],
  },
]
