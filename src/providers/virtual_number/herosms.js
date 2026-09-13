const REST_BASE =
  process.env.HEROSMS_API_BASE ||
  "https://hero-sms.com/api/v1";

const LEGACY_BASE =
  process.env.HEROSMS_LEGACY_BASE ||
  "https://hero-sms.com/stubs/handler_api.php";

const REQUEST_TIMEOUT_MS = 20_000;
const CATALOG_CACHE_MS = 60_000;
const OFFERS_CACHE_MS = 30_000;

const cache = {
  services: null,
  servicesAt: 0,
  countries: null,
  countriesAt: 0,
  offers: new Map()
};


const COUNTRY_DIAL_CODE = Object.freeze({
  "AD": "376",
  "AE": "971",
  "AF": "93",
  "AG": "1268",
  "AI": "1264",
  "AL": "355",
  "AM": "374",
  "AO": "244",
  "AR": "54",
  "AS": "1684",
  "AT": "43",
  "AU": "61",
  "AW": "297",
  "AX": "358",
  "AZ": "994",
  "BA": "387",
  "BB": "1246",
  "BD": "880",
  "BE": "32",
  "BF": "226",
  "BG": "359",
  "BH": "973",
  "BI": "257",
  "BJ": "229",
  "BL": "590",
  "BM": "1441",
  "BN": "673",
  "BO": "591",
  "BQ": "599",
  "BR": "55",
  "BS": "1242",
  "BT": "975",
  "BW": "267",
  "BY": "375",
  "BZ": "501",
  "CA": "1",
  "CC": "61",
  "CD": "243",
  "CF": "236",
  "CG": "242",
  "CH": "41",
  "CI": "225",
  "CK": "682",
  "CL": "56",
  "CM": "237",
  "CN": "86",
  "CO": "57",
  "CR": "506",
  "CU": "53",
  "CV": "238",
  "CW": "599",
  "CX": "61",
  "CY": "357",
  "CZ": "420",
  "DE": "49",
  "DJ": "253",
  "DK": "45",
  "DM": "1767",
  "DO": "1809",
  "DZ": "213",
  "EC": "593",
  "EE": "372",
  "EG": "20",
  "EH": "212",
  "ER": "291",
  "ES": "34",
  "ET": "251",
  "FI": "358",
  "FJ": "679",
  "FK": "500",
  "FM": "691",
  "FO": "298",
  "FR": "33",
  "GA": "241",
  "GB": "44",
  "GD": "1473",
  "GE": "995",
  "GF": "594",
  "GG": "44",
  "GH": "233",
  "GI": "350",
  "GL": "299",
  "GM": "220",
  "GN": "224",
  "GP": "590",
  "GQ": "240",
  "GR": "30",
  "GS": "500",
  "GT": "502",
  "GU": "1671",
  "GW": "245",
  "GY": "592",
  "HK": "852",
  "HN": "504",
  "HR": "385",
  "HT": "509",
  "HU": "36",
  "ID": "62",
  "IE": "353",
  "IL": "972",
  "IM": "44",
  "IN": "91",
  "IO": "246",
  "IQ": "964",
  "IR": "98",
  "IS": "354",
  "IT": "39",
  "JE": "44",
  "JM": "1876",
  "JO": "962",
  "JP": "81",
  "KE": "254",
  "KG": "996",
  "KH": "855",
  "KI": "686",
  "KM": "269",
  "KN": "1869",
  "KP": "850",
  "KR": "82",
  "KW": "965",
  "KY": "1345",
  "KZ": "76",
  "LA": "856",
  "LB": "961",
  "LC": "1758",
  "LI": "423",
  "LK": "94",
  "LR": "231",
  "LS": "266",
  "LT": "370",
  "LU": "352",
  "LV": "371",
  "LY": "218",
  "MA": "212",
  "MC": "377",
  "MD": "373",
  "ME": "382",
  "MF": "590",
  "MG": "261",
  "MH": "692",
  "MK": "389",
  "ML": "223",
  "MM": "95",
  "MN": "976",
  "MO": "853",
  "MP": "1670",
  "MQ": "596",
  "MR": "222",
  "MS": "1664",
  "MT": "356",
  "MU": "230",
  "MV": "960",
  "MW": "265",
  "MX": "52",
  "MY": "60",
  "MZ": "258",
  "NA": "264",
  "NC": "687",
  "NE": "227",
  "NF": "672",
  "NG": "234",
  "NI": "505",
  "NL": "31",
  "NO": "47",
  "NP": "977",
  "NR": "674",
  "NU": "683",
  "NZ": "64",
  "OM": "968",
  "PA": "507",
  "PE": "51",
  "PF": "689",
  "PG": "675",
  "PH": "63",
  "PK": "92",
  "PL": "48",
  "PM": "508",
  "PN": "64",
  "PR": "1787",
  "PS": "970",
  "PT": "351",
  "PW": "680",
  "PY": "595",
  "QA": "974",
  "RE": "262",
  "RO": "40",
  "RS": "381",
  "RU": "7",
  "RW": "250",
  "SA": "966",
  "SB": "677",
  "SC": "248",
  "SD": "249",
  "SE": "46",
  "SG": "65",
  "SH": "290",
  "SI": "386",
  "SJ": "4779",
  "SK": "421",
  "SL": "232",
  "SM": "378",
  "SN": "221",
  "SO": "252",
  "SR": "597",
  "SS": "211",
  "ST": "239",
  "SV": "503",
  "SX": "1721",
  "SY": "963",
  "SZ": "268",
  "TC": "1649",
  "TD": "235",
  "TG": "228",
  "TH": "66",
  "TJ": "992",
  "TK": "690",
  "TL": "670",
  "TM": "993",
  "TN": "216",
  "TO": "676",
  "TR": "90",
  "TT": "1868",
  "TV": "688",
  "TW": "886",
  "TZ": "255",
  "UA": "380",
  "UG": "256",
  "US": "1",
  "UY": "598",
  "UZ": "998",
  "VA": "39",
  "VC": "1784",
  "VE": "58",
  "VG": "1284",
  "VI": "1340",
  "VN": "84",
  "VU": "678",
  "WF": "681",
  "WS": "685",
  "XK": "383",
  "YE": "967",
  "YT": "262",
  "ZA": "27",
  "ZM": "260",
  "ZW": "263"
});

const COUNTRY_ISO_BY_NAME = Object.freeze({
  "ae": "AE",
  "af": "AF",
  "afganistan": "AF",
  "afghanistan": "AF",
  "ag": "AG",
  "ai": "AI",
  "al": "AL",
  "al ittihad al qumuri": "KM",
  "al jumhuriyah al arabiyah as suriyah": "SY",
  "al jumhuriyah al libnaniyah": "LB",
  "al jumhuriyyah al islamiyyah al muritaniyyah": "MR",
  "al jumhuriyyah al yamaniyyah": "YE",
  "al jumhuriyyah at tunisiyyah": "TN",
  "al mamlakah al arabiyyah as su udiyyah": "SA",
  "al mamlakah al magribiyah": "MA",
  "al mamlakah al urduniyah al hashimiyah": "JO",
  "aland islands": "AX",
  "albania": "AL",
  "algeria": "DZ",
  "algerie": "DZ",
  "am": "AM",
  "amelika samoa": "AS",
  "america": "US",
  "american samoa": "AS",
  "amerika samoa": "AS",
  "andorra": "AD",
  "angola": "AO",
  "anguilla": "AI",
  "antigua and barbuda": "AG",
  "antiguabarbuda": "AG",
  "ao": "AO",
  "aolepan aorokin majel": "MH",
  "aotearoa": "NZ",
  "ar": "AR",
  "arab republic of egypt": "EG",
  "argentina": "AR",
  "argentine republic": "AR",
  "armenia": "AM",
  "aruba": "AW",
  "as": "AS",
  "as sumal": "SO",
  "at": "AT",
  "au": "AU",
  "australia": "AU",
  "austria": "AT",
  "aw": "AW",
  "az": "AZ",
  "az rbaycan respublikas": "AZ",
  "azerbaijan": "AZ",
  "ba": "BA",
  "bahamas": "BS",
  "bahrain": "BH",
  "bailiwick of guernsey": "GG",
  "bailiwick of jersey": "JE",
  "bailliage de guernesey": "GG",
  "bailliage de jerri": "JE",
  "bailliage de jersey": "JE",
  "bangladesh": "BD",
  "barbados": "BB",
  "bb": "BB",
  "bd": "BD",
  "be": "BE",
  "belarus": "BY",
  "belgie": "BE",
  "belgien": "BE",
  "belgique": "BE",
  "belgium": "BE",
  "belize": "BZ",
  "belorussiya": "BY",
  "beluu er a belau": "PW",
  "benin": "BJ",
  "bermuda": "BM",
  "bf": "BF",
  "bg": "BG",
  "bh": "BH",
  "bharat": "IN",
  "bharat ganrajya": "IN",
  "bhutan": "BT",
  "bi": "BI",
  "bielarus": "BY",
  "bj": "BJ",
  "bm": "BM",
  "bn": "BN",
  "bo": "BO",
  "bolivarian republic of venezuela": "VE",
  "bolivia": "BO",
  "bolivia plurinational state of": "BO",
  "bonaire": "BQ",
  "bonaire sint eustatius and saba": "BQ",
  "bosnia and herzegovina": "BA",
  "bosnia herzegovina": "BA",
  "botswana": "BW",
  "br": "BR",
  "brasil": "BR",
  "brazil": "BR",
  "britain": "GB",
  "british indian ocean territory": "IO",
  "british virgin islands": "VG",
  "brunei": "BN",
  "brunei darussalam": "BN",
  "bs": "BS",
  "bt": "BT",
  "bulgaria": "BG",
  "buliwya": "BO",
  "buliwya mamallaqta": "BO",
  "bundesrepublik deutschland": "DE",
  "burkina faso": "BF",
  "burkinafaso": "BF",
  "burma": "MM",
  "burundi": "BI",
  "bw": "BW",
  "by": "BY",
  "bz": "BZ",
  "ca": "CA",
  "cabo verde": "CV",
  "caf": "CF",
  "cambodia": "KH",
  "cameroon": "CM",
  "canada": "CA",
  "cape verde": "CV",
  "cayman islands": "KY",
  "caymanislands": "KY",
  "cc": "CC",
  "cd": "CD",
  "central african republic": "CF",
  "ceska republika": "CZ",
  "cesko": "CZ",
  "cf": "CF",
  "cg": "CG",
  "ch": "CH",
  "chad": "TD",
  "chile": "CL",
  "china": "CN",
  "choson minjujuui inmin konghwaguk": "KP",
  "christmas island": "CX",
  "ci": "CI",
  "ck": "CK",
  "cl": "CL",
  "cm": "CM",
  "cn": "CN",
  "co": "CO",
  "co operative republic of guyana": "GY",
  "cocos keeling islands": "CC",
  "collectivite territoriale de saint pierre et miquelon": "PM",
  "colombia": "CO",
  "commonwealth of dominica": "DM",
  "commonwealth of puerto rico": "PR",
  "commonwealth of the bahamas": "BS",
  "commonwealth of the northern mariana islands": "MP",
  "comoros": "KM",
  "cong hoa xa hoi chu nghia viet nam": "VN",
  "congo": "CG",
  "congo brazzaville": "CG",
  "congo democratic republic": "CD",
  "congo kinshasa": "CD",
  "congo the democratic republic of the": "CD",
  "cook islands": "CK",
  "costa rica": "CR",
  "cote d ivoire": "CI",
  "cr": "CR",
  "croatia": "HR",
  "cu": "CU",
  "cuba": "CU",
  "cumhuriyi tocikiston": "TJ",
  "curacao": "CW",
  "cv": "CV",
  "cx": "CX",
  "cy": "CY",
  "cyprus": "CY",
  "cz": "CZ",
  "czech republic": "CZ",
  "czechia": "CZ",
  "danmark": "DK",
  "dawlat al kuwait": "KW",
  "dawlat iritriya": "ER",
  "dawlat libya": "LY",
  "dawlat qatar": "QA",
  "de": "DE",
  "democratic people s republic of korea": "KP",
  "democratic republic of sao tome and principe": "ST",
  "democratic republic of the congo": "CD",
  "democratic republic of timor leste": "TL",
  "democratic socialist republic of sri lanka": "LK",
  "denmark": "DK",
  "departement de mayotte": "YT",
  "department of mayotte": "YT",
  "dhivehi raajjeyge jumhooriyya": "MV",
  "dj": "DJ",
  "djibouti": "DJ",
  "dk": "DK",
  "dm": "DM",
  "do": "DO",
  "dominica": "DM",
  "dominican republic": "DO",
  "dominique": "DM",
  "dprk": "KP",
  "dr congo": "CD",
  "drc": "CD",
  "dz": "DZ",
  "dzayer": "DZ",
  "east timor": "TL",
  "eastern republic of uruguay": "UY",
  "ec": "EC",
  "ecuador": "EC",
  "ee": "EE",
  "eesti": "EE",
  "eesti vabariik": "EE",
  "eg": "EG",
  "egypt": "EG",
  "eh": "EH",
  "eire": "IE",
  "el salvador": "SV",
  "ellada": "GR",
  "ellan vannin": "IM",
  "england": "GB",
  "equatorial guinea": "GQ",
  "equatorialguinea": "GQ",
  "er": "ER",
  "eritrea": "ER",
  "ertra": "ER",
  "es": "ES",
  "estado libre asociado de puerto rico": "PR",
  "estado plurinacional de bolivia": "BO",
  "estados unidos mexicanos": "MX",
  "estonia": "EE",
  "eswatini": "SZ",
  "et": "ET",
  "ethiopia": "ET",
  "f r erne": "FO",
  "f royar": "FO",
  "falkland islands": "FK",
  "falkland islands malvinas": "FK",
  "faroe islands": "FO",
  "federal democratic republic of ethiopia": "ET",
  "federal democratic republic of nepal": "NP",
  "federal republic of germany": "DE",
  "federal republic of nigeria": "NG",
  "federal republic of somalia": "SO",
  "federated states of micronesia": "FM",
  "federation of saint christopher and nevis": "KN",
  "federative republic of brazil": "BR",
  "fi": "FI",
  "fiji": "FJ",
  "fiji ganarajya": "FJ",
  "finland": "FI",
  "fj": "FJ",
  "fk": "FK",
  "fm": "FM",
  "fo": "FO",
  "fr": "FR",
  "france": "FR",
  "french guiana": "GF",
  "french polynesia": "PF",
  "french republic": "FR",
  "french southern and antarctic lands": "TF",
  "french southern territories": "TF",
  "frenchguiana": "GF",
  "furstentum liechtenstein": "LI",
  "ga": "GA",
  "gabon": "GA",
  "gabonese republic": "GA",
  "gabuuti": "DJ",
  "gabuutih ummuuno": "DJ",
  "gambia": "GM",
  "gb": "GB",
  "gd": "GD",
  "ge": "GE",
  "georgia": "GE",
  "germany": "DE",
  "gf": "GF",
  "gg": "GG",
  "gh": "GH",
  "ghana": "GH",
  "gi": "GI",
  "gibraltar": "GI",
  "gl": "GL",
  "gm": "GM",
  "gn": "GN",
  "gonoprojatontri bangladesh": "BD",
  "gp": "GP",
  "gq": "GQ",
  "gr": "GR",
  "gr nland": "GL",
  "grand duche de luxembourg": "LU",
  "grand duchy of luxembourg": "LU",
  "great britain": "GB",
  "greece": "GR",
  "greenland": "GL",
  "grenada": "GD",
  "gro herzogtum luxemburg": "LU",
  "groussherzogtum letzebuerg": "LU",
  "gs": "GS",
  "gt": "GT",
  "gu": "GU",
  "guadeloupe": "GP",
  "guahan": "GU",
  "guam": "GU",
  "guatemala": "GT",
  "guernsey": "GG",
  "guiana": "GF",
  "guinea": "GN",
  "guinea bissau": "GW",
  "guineabissau": "GW",
  "guyana": "GY",
  "guyane": "GF",
  "gw": "GW",
  "gwadloup": "GP",
  "gy": "GY",
  "haiti": "HT",
  "hashemite kingdom of jordan": "JO",
  "hayastan": "AM",
  "heard island and mcdonald islands": "HM",
  "hellenic republic": "GR",
  "hk": "HK",
  "hm": "HM",
  "hn": "HN",
  "holland": "NL",
  "holy see": "VA",
  "honduras": "HN",
  "hong kong": "HK",
  "hong kong special administrative region of china": "HK",
  "hongkong": "HK",
  "hr": "HR",
  "hrvatska": "HR",
  "ht": "HT",
  "hu": "HU",
  "hungary": "HU",
  "iceland": "IS",
  "id": "ID",
  "ie": "IE",
  "il": "IL",
  "ilankai": "LK",
  "im": "IM",
  "in": "IN",
  "independen stet bilong papua niugini": "PG",
  "independent state of papua new guinea": "PG",
  "independent state of samoa": "WS",
  "india": "IN",
  "indonesia": "ID",
  "io": "IO",
  "iq": "IQ",
  "ir": "IR",
  "iran": "IR",
  "iran islamic republic of": "IR",
  "iraq": "IQ",
  "ireland": "IE",
  "iritriya": "ER",
  "is": "IS",
  "islami jumhuriya eh pakistan": "PK",
  "islamic republic of afghanistan": "AF",
  "islamic republic of iran": "IR",
  "islamic republic of mauritania": "MR",
  "islamic republic of pakistan": "PK",
  "island": "IS",
  "islas malvinas": "FK",
  "isle of man": "IM",
  "israel": "IL",
  "it": "IT",
  "italian republic": "IT",
  "italy": "IT",
  "ityoppya": "ET",
  "ivory coast": "CI",
  "jabuuti": "DJ",
  "jamaica": "JM",
  "jamhuri ya kenya": "KE",
  "jamhuri ya muungano wa tanzania": "TZ",
  "jamhuri ya uganda": "UG",
  "jamhuuriyadda federaalka soomaaliya": "SO",
  "jamhuuriyadda jabuuti": "DJ",
  "japan": "JP",
  "je": "JE",
  "jersey": "JE",
  "jm": "JM",
  "jo": "JO",
  "jomhuri ye eslami ye iran": "IR",
  "jordan": "JO",
  "jp": "JP",
  "jumhuriyat as sudan": "SD",
  "jumhuriyyat al iraq": "IQ",
  "jumhuriyyat as sumal al fideraliyya": "SO",
  "k br s": "CY",
  "k br s cumhuriyeti": "CY",
  "kazakhstan": "KZ",
  "ke": "KE",
  "keeling islands": "CC",
  "kenya": "KE",
  "kg": "KG",
  "kh": "KH",
  "ki": "KI",
  "kingdom of bahrain": "BH",
  "kingdom of belgium": "BE",
  "kingdom of bhutan": "BT",
  "kingdom of cambodia": "KH",
  "kingdom of denmark": "DK",
  "kingdom of eswatini": "SZ",
  "kingdom of lesotho": "LS",
  "kingdom of morocco": "MA",
  "kingdom of norway": "NO",
  "kingdom of saudi arabia": "SA",
  "kingdom of spain": "ES",
  "kingdom of swaziland": "SZ",
  "kingdom of sweden": "SE",
  "kingdom of thailand": "TH",
  "kingdom of the netherlands": "NL",
  "kingdom of tonga": "TO",
  "kiribati": "KI",
  "km": "KM",
  "kn": "KN",
  "kongeriget danmark": "DK",
  "kongeriket noreg": "NO",
  "kongeriket norge": "NO",
  "konigreich belgien": "BE",
  "koninkrijk belgie": "BE",
  "konungariket sverige": "SE",
  "korea democratic people s republic of": "KP",
  "korea north": "KP",
  "korea republic of": "KR",
  "korea south": "KR",
  "kosovo": "XK",
  "kp": "KP",
  "kr": "KR",
  "kuki airani": "CK",
  "kuwait": "KW",
  "kw": "KW",
  "ky": "KY",
  "kypros": "CY",
  "kyrgyz republic": "KG",
  "kyrgyz respublikasy": "KG",
  "kyrgyzstan": "KG",
  "kz": "KZ",
  "la": "LA",
  "lao": "LA",
  "lao pdr": "LA",
  "lao people s democratic republic": "LA",
  "laos": "LA",
  "latvia": "LV",
  "latvijas republika": "LV",
  "lb": "LB",
  "lc": "LC",
  "lebanese republic": "LB",
  "lebanon": "LB",
  "lefatshe la botswana": "BW",
  "lesotho": "LS",
  "li": "LI",
  "liberia": "LR",
  "libya": "LY",
  "liechtenstein": "LI",
  "lietuvos respublika": "LT",
  "lithuania": "LT",
  "lk": "LK",
  "loktantrik ganatantra nepal": "NP",
  "lr": "LR",
  "ls": "LS",
  "lt": "LT",
  "lu": "LU",
  "luxembourg": "LU",
  "lv": "LV",
  "ly": "LY",
  "ly veldi island": "IS",
  "ma": "MA",
  "macao": "MO",
  "macao special administrative region of china": "MO",
  "macao special administrative region of the people s republic of china": "MO",
  "macau": "MO",
  "madagascar": "MG",
  "malawi": "MW",
  "malaysia": "MY",
  "maldive islands": "MV",
  "maldives": "MV",
  "mali": "ML",
  "malo sa oloto tuto atasi o samoa": "WS",
  "malta": "MT",
  "mamlakat al bahrayn": "BH",
  "mann": "IM",
  "mannin": "IM",
  "marshall islands": "MH",
  "martinique": "MQ",
  "matanitu ko viti": "FJ",
  "mauritania": "MR",
  "mauritius": "MU",
  "mayotte": "YT",
  "mc": "MC",
  "md": "MD",
  "medinat yisra el": "IL",
  "mexicanos": "MX",
  "mexico": "MX",
  "mg": "MG",
  "mh": "MH",
  "micronesia federated states of": "FM",
  "mk": "MK",
  "ml": "ML",
  "mn": "MN",
  "mo": "MO",
  "moldova": "MD",
  "moldova republic of": "MD",
  "monaco": "MC",
  "mongolia": "MN",
  "montenegro": "ME",
  "montserrat": "MS",
  "morocco": "MA",
  "mozambique": "MZ",
  "mp": "MP",
  "mq": "MQ",
  "mr": "MR",
  "ms": "MS",
  "mt": "MT",
  "mu": "MU",
  "muso oa lesotho": "LS",
  "mv": "MV",
  "mw": "MW",
  "mx": "MX",
  "my": "MY",
  "myanmar": "MM",
  "mz": "MZ",
  "na": "NA",
  "naijiria": "NG",
  "namibia": "NA",
  "namibie": "NA",
  "naoero": "NR",
  "nation of brunei": "BN",
  "nauru": "NR",
  "nc": "NC",
  "ne": "NE",
  "nederland": "NL",
  "nepal": "NP",
  "netherlands": "NL",
  "new caledonia": "NC",
  "new zealand": "NZ",
  "newcaledonia": "NC",
  "newzealand": "NZ",
  "nf": "NF",
  "ng": "NG",
  "ngwane": "SZ",
  "ni": "NI",
  "nicaragua": "NI",
  "niger": "NE",
  "nigeria": "NG",
  "nihon": "JP",
  "nijar": "NE",
  "nijeriya": "NG",
  "nippon": "JP",
  "niue": "NU",
  "nl": "NL",
  "no": "NO",
  "noreg": "NO",
  "norfolk island": "NF",
  "norge": "NO",
  "north korea": "KP",
  "north macedonia": "MK",
  "northern mariana islands": "MP",
  "northmacedonia": "MK",
  "norway": "NO",
  "np": "NP",
  "nr": "NR",
  "nu": "NU",
  "nz": "NZ",
  "o zbekiston respublikasi": "UZ",
  "oesterreich": "AT",
  "om": "OM",
  "oman": "OM",
  "oriental republic of uruguay": "UY",
  "osterreich": "AT",
  "pa": "PA",
  "pakistan": "PK",
  "palau": "PW",
  "palestine": "PS",
  "panama": "PA",
  "papua new guinea": "PG",
  "paraguay": "PY",
  "pe": "PE",
  "people s democratic republic of algeria": "DZ",
  "people s republic of bangladesh": "BD",
  "people s republic of china": "CN",
  "peru": "PE",
  "pf": "PF",
  "pg": "PG",
  "ph": "PH",
  "philippines": "PH",
  "pitcairn": "PN",
  "pitcairn henderson ducie and oeno islands": "PN",
  "pitcairn islands": "PN",
  "pk": "PK",
  "pl": "PL",
  "pleasant island": "NR",
  "plurinational state of bolivia": "BO",
  "pm": "PM",
  "pn": "PN",
  "poblacht na heireann": "IE",
  "poland": "PL",
  "polynesie francaise": "PF",
  "porinetia farani": "PF",
  "portugal": "PT",
  "portuguesa": "PT",
  "portuguese republic": "PT",
  "pr": "PR",
  "prathet": "TH",
  "principality of liechtenstein": "LI",
  "principality of monaco": "MC",
  "principaute de monaco": "MC",
  "pt": "PT",
  "publika de an la": "AO",
  "puerto rico": "PR",
  "pw": "PW",
  "py": "PY",
  "qa": "QA",
  "qatar": "QA",
  "qazaqstan": "KZ",
  "qazaqstan respublikas": "KZ",
  "ratcha anachak thai": "TH",
  "re": "RE",
  "regiao administrativa especial de macau da republica popular da china": "MO",
  "reino de espana": "ES",
  "repiblik ayiti": "HT",
  "repiblik sesel": "SC",
  "repoblikan i madagasikara": "MG",
  "repubblica di san marino": "SM",
  "repubblica italiana": "IT",
  "repubblika ta malta": "MT",
  "republic of albania": "AL",
  "republic of angola": "AO",
  "republic of armenia": "AM",
  "republic of austria": "AT",
  "republic of azerbaijan": "AZ",
  "republic of belarus": "BY",
  "republic of benin": "BJ",
  "republic of bosnia and herzegovina": "BA",
  "republic of botswana": "BW",
  "republic of bulgaria": "BG",
  "republic of burundi": "BI",
  "republic of cabo verde": "CV",
  "republic of cameroon": "CM",
  "republic of chad": "TD",
  "republic of chile": "CL",
  "republic of china": "TW",
  "republic of colombia": "CO",
  "republic of costa rica": "CR",
  "republic of cote d ivoire": "CI",
  "republic of croatia": "HR",
  "republic of cuba": "CU",
  "republic of cyprus": "CY",
  "republic of djibouti": "DJ",
  "republic of ecuador": "EC",
  "republic of el salvador": "SV",
  "republic of equatorial guinea": "GQ",
  "republic of estonia": "EE",
  "republic of fiji": "FJ",
  "republic of finland": "FI",
  "republic of ghana": "GH",
  "republic of guatemala": "GT",
  "republic of guinea": "GN",
  "republic of guinea bissau": "GW",
  "republic of guyana": "GY",
  "republic of haiti": "HT",
  "republic of honduras": "HN",
  "republic of iceland": "IS",
  "republic of india": "IN",
  "republic of indonesia": "ID",
  "republic of iraq": "IQ",
  "republic of ireland": "IE",
  "republic of kazakhstan": "KZ",
  "republic of kenya": "KE",
  "republic of kiribati": "KI",
  "republic of korea": "KR",
  "republic of latvia": "LV",
  "republic of liberia": "LR",
  "republic of lithuania": "LT",
  "republic of macedonia": "MK",
  "republic of madagascar": "MG",
  "republic of malawi": "MW",
  "republic of maldives": "MV",
  "republic of mali": "ML",
  "republic of malta": "MT",
  "republic of mauritius": "MU",
  "republic of moldova": "MD",
  "republic of mozambique": "MZ",
  "republic of namibia": "NA",
  "republic of nauru": "NR",
  "republic of nicaragua": "NI",
  "republic of niger": "NE",
  "republic of north macedonia": "MK",
  "republic of palau": "PW",
  "republic of panama": "PA",
  "republic of paraguay": "PY",
  "republic of peru": "PE",
  "republic of poland": "PL",
  "republic of rwanda": "RW",
  "republic of san marino": "SM",
  "republic of senegal": "SN",
  "republic of serbia": "RS",
  "republic of seychelles": "SC",
  "republic of sierra leone": "SL",
  "republic of singapore": "SG",
  "republic of slovenia": "SI",
  "republic of south africa": "ZA",
  "republic of south sudan": "SS",
  "republic of suriname": "SR",
  "republic of tajikistan": "TJ",
  "republic of the congo": "CG",
  "republic of the gambia": "GM",
  "republic of the maldives": "MV",
  "republic of the marshall islands": "MH",
  "republic of the niger": "NE",
  "republic of the philippines": "PH",
  "republic of the sudan": "SD",
  "republic of trinidad and tobago": "TT",
  "republic of tunisia": "TN",
  "republic of turkey": "TR",
  "republic of turkiye": "TR",
  "republic of uganda": "UG",
  "republic of uzbekistan": "UZ",
  "republic of vanuatu": "VU",
  "republic of yemen": "YE",
  "republic of zambia": "ZM",
  "republic of zimbabwe": "ZW",
  "republica argentina": "AR",
  "republica bolivariana de venezuela": "VE",
  "republica da guine bissau": "GW",
  "republica da guine equatorial": "GQ",
  "republica de angola": "AO",
  "republica de cabo verde": "CV",
  "republica de chile": "CL",
  "republica de colombia": "CO",
  "republica de costa rica": "CR",
  "republica de cuba": "CU",
  "republica de el salvador": "SV",
  "republica de guinea ecuatorial": "GQ",
  "republica de honduras": "HN",
  "republica de mocambique": "MZ",
  "republica de nicaragua": "NI",
  "republica de panama": "PA",
  "republica del ecuador": "EC",
  "republica del paraguay": "PY",
  "republica del peru": "PE",
  "republica democratica de sao tome e principe": "ST",
  "republica democratica de timor leste": "TL",
  "republica federativa do brasil": "BR",
  "republica moldova": "MD",
  "republica oriental del uruguay": "UY",
  "republica portuguesa": "PT",
  "republiek suriname": "SR",
  "republik indonesia": "ID",
  "republik singapura": "SG",
  "republika demokratika timor leste": "TL",
  "republika hrvatska": "HR",
  "republika ng pilipinas": "PH",
  "republika slovenija": "SI",
  "republika srbija": "RS",
  "republika y uburundi": "BI",
  "republiken finland": "FI",
  "republique centrafricaine": "CF",
  "republique d haiti": "HT",
  "republique de cote d ivoire": "CI",
  "republique de djibouti": "DJ",
  "republique de guinee": "GN",
  "republique de guinee equatoriale": "GQ",
  "republique de madagascar": "MG",
  "republique de maurice": "MU",
  "republique de vanuatu": "VU",
  "republique des seychelles": "SC",
  "republique du benin": "BJ",
  "republique du burundi": "BI",
  "republique du cameroun": "CM",
  "republique du mali": "ML",
  "republique du niger": "NE",
  "republique du rwanda": "RW",
  "republique du senegal": "SN",
  "republique du tchad": "TD",
  "republique francaise": "FR",
  "republique gabonaise": "GA",
  "republique togolaise": "TG",
  "repubulika y u rwanda": "RW",
  "respublika belarus": "BY",
  "respublika kazakhstan": "KZ",
  "reunion": "RE",
  "ribaberiki kiribati": "KI",
  "ripablik blong vanuatu": "VU",
  "ripublik naoero": "NR",
  "ro": "RO",
  "romania": "RO",
  "rossiya": "RU",
  "rossiyskaya federatsiya": "RU",
  "roumania": "RO",
  "royaume de belgique": "BE",
  "rsa": "ZA",
  "ru": "RU",
  "rumania": "RO",
  "russia": "RU",
  "russian federation": "RU",
  "rw": "RW",
  "rwanda": "RW",
  "rwandese republic": "RW",
  "rzeczpospolita polska": "PL",
  "sa": "SA",
  "saint barthelemy": "BL",
  "saint helena": "SH",
  "saint helena ascension and tristan da cunha": "SH",
  "saint kitts and nevis": "KN",
  "saint lucia": "LC",
  "saint martin": "MF",
  "saint pierre and miquelon": "PM",
  "saint vincent and the grenadines": "VC",
  "saintkitts": "KN",
  "saintlucia": "LC",
  "saintvincentgrenadines": "VC",
  "sakartvelo": "GE",
  "saltanat uman": "OM",
  "samoa": "WS",
  "samoa amelika": "AS",
  "san marino": "SM",
  "sankattan siha na islas marianas": "MP",
  "sao tome and principe": "ST",
  "saotomeandprincipe": "ST",
  "sarnam": "SR",
  "sathalanalat paxathipatai paxaxon lao": "LA",
  "saudi arabia": "SA",
  "saudiarabia": "SA",
  "sb": "SB",
  "sc": "SC",
  "schweiz": "CH",
  "sd": "SD",
  "se": "SE",
  "senegal": "SN",
  "serbia": "RS",
  "seychelles": "SC",
  "sg": "SG",
  "sh": "SH",
  "shqiperi": "AL",
  "shqiperia": "AL",
  "shqipnia": "AL",
  "si": "SI",
  "sierra leone": "SL",
  "sierraleone": "SL",
  "singapore": "SG",
  "singapura": "SG",
  "sint maarten": "SX",
  "sj": "SJ",
  "sk": "SK",
  "sl": "SL",
  "slovak republic": "SK",
  "slovakia": "SK",
  "slovenia": "SI",
  "slovenska republika": "SK",
  "sm": "SM",
  "sn": "SN",
  "so": "SO",
  "socialist republic of viet nam": "VN",
  "socialist republic of vietnam": "VN",
  "solomon islands": "SB",
  "somalia": "SO",
  "somers isles": "BM",
  "south africa": "ZA",
  "south georgia": "GS",
  "south georgia and the south sandwich islands": "GS",
  "south korea": "KR",
  "south sudan": "SS",
  "southafrica": "ZA",
  "spain": "ES",
  "sr": "SR",
  "sranangron": "SR",
  "srbija": "RS",
  "sri lanka": "LK",
  "ss": "SS",
  "st": "ST",
  "st barthelemy": "BL",
  "st martin": "MF",
  "state of eritrea": "ER",
  "state of israel": "IL",
  "state of kuwait": "KW",
  "state of libya": "LY",
  "state of palestine": "PS",
  "state of qatar": "QA",
  "sudan": "SD",
  "suid afrika": "ZA",
  "suisse": "CH",
  "sultanate of oman": "OM",
  "suomen tasavalta": "FI",
  "suomi": "FI",
  "suriname": "SR",
  "sv": "SV",
  "svalbard and jan mayen": "SJ",
  "svalbard and jan mayen islands": "SJ",
  "svizra": "CH",
  "svizzera": "CH",
  "swatini": "SZ",
  "swaziland": "SZ",
  "sweden": "SE",
  "swiss confederation": "CH",
  "switzerland": "CH",
  "sy": "SY",
  "syria": "SY",
  "syrian arab republic": "SY",
  "sz": "SZ",
  "taiwan": "TW",
  "taiwan province of china": "TW",
  "tajikistan": "TJ",
  "tanezroft tutrimt": "EH",
  "tanzania": "TZ",
  "tanzania united republic of": "TZ",
  "tchad": "TD",
  "td": "TD",
  "teratri of norf k ailen": "NF",
  "territoire des iles wallis et futuna": "WF",
  "territory of christmas island": "CX",
  "territory of norfolk island": "NF",
  "territory of the cocos keeling islands": "CC",
  "territory of the wallis and futuna islands": "WF",
  "teta paraguai": "PY",
  "teta volivia": "BO",
  "tf": "TF",
  "tg": "TG",
  "th": "TH",
  "thai": "TH",
  "thailand": "TH",
  "the abode of peace": "BN",
  "the bahamas": "BS",
  "the bermudas": "BM",
  "the gambia": "GM",
  "the islands of bermuda": "BM",
  "the state of eritrea": "ER",
  "timor leste": "TL",
  "tj": "TJ",
  "tk": "TK",
  "tl": "TL",
  "tm": "TM",
  "tn": "TN",
  "to": "TO",
  "tocikiston": "TJ",
  "togo": "TG",
  "togolese": "TG",
  "togolese republic": "TG",
  "tokelau": "TK",
  "tonga": "TO",
  "tr": "TR",
  "trinidad and tobago": "TT",
  "tt": "TT",
  "tunisia": "TN",
  "turkey": "TR",
  "turkiye": "TR",
  "turkiye cumhuriyeti": "TR",
  "turkmenistan": "TM",
  "turks and caicos islands": "TC",
  "tuvalu": "TV",
  "tv": "TV",
  "tw": "TW",
  "tz": "TZ",
  "u k": "GB",
  "u s a": "US",
  "ua": "UA",
  "uae": "AE",
  "udzima wa komori": "KM",
  "ug": "UG",
  "uganda": "UG",
  "uk": "GB",
  "ukraine": "UA",
  "ukrayina": "UA",
  "umbuso waseswatini": "SZ",
  "union des comores": "KM",
  "union of the comoros": "KM",
  "united arab emirates": "AE",
  "united kingdom": "GB",
  "united kingdom of great britain and northern ireland": "GB",
  "united mexican states": "MX",
  "united republic of tanzania": "TZ",
  "united states": "US",
  "united states of america": "US",
  "uruguay": "UY",
  "us": "US",
  "us virgin islands": "VI",
  "usa": "US",
  "uy": "UY",
  "uz": "UZ",
  "uzbekistan": "UZ",
  "vanuatu": "VU",
  "vatican": "VA",
  "vatican city": "VA",
  "vc": "VC",
  "ve": "VE",
  "venezuela": "VE",
  "venezuela bolivarian republic of": "VE",
  "viet nam": "VN",
  "vietnam": "VN",
  "virgin islands british": "VG",
  "virgin islands us": "VI",
  "viti": "FJ",
  "vn": "VN",
  "vu": "VU",
  "wai tu kubuli": "DM",
  "wales": "GB",
  "wallis and futuna": "WF",
  "western sahara": "EH",
  "weswatini": "SZ",
  "wf": "WF",
  "ws": "WS",
  "wuliwya": "BO",
  "wuliwya suyu": "BO",
  "ye": "YE",
  "yemen": "YE",
  "yemeni republic": "YE",
  "yt": "YT",
  "za": "ZA",
  "zambia": "ZM",
  "zhongguo": "CN",
  "zhonghua": "CN",
  "zhonghua minguo": "TW",
  "zhonghua renmin gongheguo": "CN",
  "zimbabwe": "ZW",
  "zm": "ZM",
  "zw": "ZW"
});

const PERSIAN_REGION_NAME_OVERRIDES = Object.freeze({
  XK: "کوزوو"
});

let persianRegionNames = null;

try {
  persianRegionNames = new Intl.DisplayNames(
    ["fa"],
    { type: "region" }
  );
} catch {}

function normalizeCountryKey(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function flagFromIso2(iso2) {
  const code =
    String(iso2 || "")
      .toUpperCase();

  if (!/^[A-Z]{2}$/.test(code)) {
    return "🌍";
  }

  return String.fromCodePoint(
    ...[...code].map(
      (char) =>
        127397 + char.charCodeAt(0)
    )
  );
}

function countryPresentation(
  englishName,
  countryId
) {
  const rawName =
    String(englishName || "").trim();

  const key =
    normalizeCountryKey(rawName);

  const iso2 =
    COUNTRY_ISO_BY_NAME[key] || "";

  if (!iso2) {
    return {
      countryId: Number(countryId),
      iso2: "",
      flag: "🌍",
      name:
        rawName ||
        `کشور ${Number(countryId)}`,
      phoneCode: ""
    };
  }

  let localizedName =
    PERSIAN_REGION_NAME_OVERRIDES[
      iso2
    ] || "";

  if (
    !localizedName &&
    persianRegionNames
  ) {
    try {
      localizedName =
        persianRegionNames.of(iso2) ||
        "";
    } catch {}
  }

  return {
    countryId: Number(countryId),
    iso2,
    flag: flagFromIso2(iso2),
    name:
      localizedName ||
      rawName ||
      iso2,
    phoneCode:
      COUNTRY_DIAL_CODE[iso2] || ""
  };
}

const VIRTUAL_NUMBER_SERVICE_PRIORITY =
  Object.freeze([
    ["whatsapp"],
    ["telegram"],
    ["google", "gmail"],
    ["instagram"],
    ["facebook"],
    ["tiktok", "tik tok"],
    ["discord"],
    ["microsoft", "outlook", "hotmail"],
    ["apple", "icloud"],
    ["twitter"],
    ["snapchat"],
    ["amazon"],
    ["uber"],
    ["paypal"],
    ["netflix"],
    ["openai", "chatgpt"],
    ["viber"],
    ["line"],
    ["tinder"],
    ["steam"],
    ["yahoo"],
    ["linkedin"]
  ]);

function virtualNumberServicePriority(
  service
) {
  const name =
    String(service?.name || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  for (
    let i = 0;
    i <
      VIRTUAL_NUMBER_SERVICE_PRIORITY.length;
    i += 1
  ) {
    if (
      VIRTUAL_NUMBER_SERVICE_PRIORITY[
        i
      ].some(
        (alias) =>
          name.includes(alias)
      )
    ) {
      return i;
    }
  }

  return 10_000;
}


export class HeroSmsApiError extends Error {
  constructor(
    message,
    {
      status = 0,
      code = "api_error",
      details = "",
      payload = null
    } = {}
  ) {
    super(message);
    this.name = "HeroSmsApiError";
    this.status = Number(status) || 0;
    this.code = String(code || "api_error");
    this.details = String(details || "");
    this.payload = payload;
  }
}

function apiKey() {
  const key =
    process.env.HEROSMS_API_KEY ||
    process.env.hero_sms_api_key;

  if (!key) {
    throw new HeroSmsApiError(
      "HEROSMS_API_KEY is missing",
      { code: "config_error" }
    );
  }

  return String(key).trim();
}

function withTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  return { controller, timer };
}

function parseErrorPayload(
  status,
  payload,
  fallback = "HeroSMS API error"
) {
  const title =
    payload && typeof payload === "object"
      ? payload.title || payload.error || payload.status
      : "";

  const details =
    payload && typeof payload === "object"
      ? payload.details || payload.message || ""
      : String(payload || "");

  return new HeroSmsApiError(
    details || title || fallback,
    {
      status,
      code: title || `http_${status}`,
      details,
      payload
    }
  );
}

async function requestRest(
  path,
  {
    method = "GET",
    query = null,
    body = null
  } = {}
) {
  const url = new URL(
    `${String(REST_BASE).replace(/\/+$/, "")}${path}`
  );

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (
        value !== undefined &&
        value !== null &&
        value !== ""
      ) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const { controller, timer } = withTimeout();

  try {
    const headers = {
      Authorization: `ApiKey ${apiKey()}`,
      Accept: "application/json"
    };

    const options = {
      method,
      headers,
      signal: controller.signal
    };

    if (body !== null) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const raw = await response.text();

    let payload = null;

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    } else {
      payload = {};
    }

    if (!response.ok) {
      throw parseErrorPayload(
        response.status,
        payload,
        `HeroSMS HTTP ${response.status}`
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof HeroSmsApiError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new HeroSmsApiError(
        "HeroSMS request timed out",
        { code: "timeout" }
      );
    }

    throw new HeroSmsApiError(
      String(
        error?.message ||
        error ||
        "HeroSMS network error"
      ),
      { code: "network_error" }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function requestLegacy(action, params = {}) {
  const url = new URL(LEGACY_BASE);

  url.searchParams.set("action", action);
  url.searchParams.set("api_key", apiKey());

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  }

  const { controller, timer } = withTimeout();

  try {
    const response = await fetch(
      url,
      {
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      }
    );

    const raw = await response.text();

    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = raw;
    }

    if (!response.ok) {
      throw parseErrorPayload(
        response.status,
        payload,
        `HeroSMS legacy HTTP ${response.status}`
      );
    }

    if (
      typeof payload === "string" &&
      /^(BAD_|NO_|ERROR|WRONG_|ACCESS_DENIED|ACCOUNT_)/i.test(
        payload
      )
    ) {
      throw new HeroSmsApiError(
        payload,
        {
          code: payload.split(":")[0],
          payload
        }
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof HeroSmsApiError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new HeroSmsApiError(
        "HeroSMS request timed out",
        { code: "timeout" }
      );
    }

    throw new HeroSmsApiError(
      String(
        error?.message ||
        error ||
        "HeroSMS network error"
      ),
      { code: "network_error" }
    );
  } finally {
    clearTimeout(timer);
  }
}

export function virtualNumberSellingPrice(providerPrice) {
  const price = Number(providerPrice || 0);

  if (!Number.isFinite(price) || price < 0) {
    return 0;
  }

  // Exact business rule: API price + 40%.
  return Number((price * 1.4).toFixed(4));
}

export function extractProviderPrice(offer) {
  if (!offer || typeof offer !== "object") {
    return 0;
  }

  const priceMap =
    offer.map && typeof offer.map === "object"
      ? offer.map
      : {};

  const availablePrices =
    Object.entries(priceMap)
      .filter(([, count]) => Number(count) > 0)
      .map(([price]) => Number(price))
      .filter(
        (price) =>
          Number.isFinite(price) &&
          price > 0
      );

  if (availablePrices.length) {
    return Math.min(...availablePrices);
  }

  const candidates = [
    offer?.prices?.min,
    offer?.prices?.default,
    offer?.prices?.retail
  ]
    .map(Number)
    .filter(
      (price) =>
        Number.isFinite(price) &&
        price > 0
    );

  return candidates.length
    ? Math.min(...candidates)
    : 0;
}

export async function getHeroSmsServices({
  fresh = false
} = {}) {
  const now = Date.now();

  if (
    !fresh &&
    cache.services &&
    now - cache.servicesAt < CATALOG_CACHE_MS
  ) {
    return cache.services;
  }

  const payload =
    await requestLegacy(
      "getServicesList",
      { lang: "en" }
    );

  const services = Array.isArray(payload?.services)
    ? payload.services
    : Array.isArray(payload)
      ? payload
      : [];

  const normalized = services
    .map((item) => ({
      code: String(
        item?.code || item?.id || ""
      ).trim(),
      name: String(
        item?.name ||
        item?.title ||
        item?.code ||
        ""
      ).trim()
    }))
    .filter(
      (item) =>
        item.code &&
        item.name
    );

  cache.services = normalized;
  cache.servicesAt = now;

  return normalized;
}

export async function getHeroSmsCountries({
  fresh = false
} = {}) {
  const now = Date.now();

  if (
    !fresh &&
    cache.countries &&
    now - cache.countriesAt < CATALOG_CACHE_MS
  ) {
    return cache.countries;
  }

  const payload =
    await requestLegacy("getCountries");

  let countries = [];

  if (Array.isArray(payload)) {
    countries = payload;
  } else if (
    Array.isArray(payload?.countries)
  ) {
    countries = payload.countries;
  } else if (
    Array.isArray(payload?.data)
  ) {
    countries = payload.data;
  } else {
    const source =
      payload?.countries &&
      typeof payload.countries ===
        "object"
        ? payload.countries
        : payload?.data &&
            typeof payload.data ===
              "object"
          ? payload.data
          : payload &&
              typeof payload ===
                "object"
            ? payload
            : {};

    countries =
      Object.entries(source)
        .filter(
          ([, item]) =>
            item &&
            typeof item === "object"
        )
        .map(
          ([key, item]) => ({
            ...item,
            id:
              item.id !== undefined
                ? item.id
                : key
          })
        );
  }

  const normalized = countries
    .map((item) => {
      const id =
        Number(item?.id);

      const englishName =
        String(
          item?.eng ||
          item?.name ||
          item?.title ||
          ""
        ).trim();

      const presentation =
        countryPresentation(
          englishName,
          id
        );

      return {
        id,
        englishName,
        name:
          presentation.name,
        flag:
          presentation.flag,
        phoneCode:
          presentation.phoneCode,
        iso2:
          presentation.iso2,
        visible:
          item?.visible === undefined
            ? true
            : Number(item.visible) === 1
      };
    })
    .filter(
      (item) =>
        Number.isFinite(item.id) &&
        (
          item.englishName ||
          item.name
        )
    );

  cache.countries = normalized;
  cache.countriesAt = now;

  return normalized;
}

export async function getHeroSmsOffers({
  verificationType = "sms",
  service = "",
  country = "",
  fresh = false
} = {}) {
  const type =
    verificationType === "call"
      ? "call"
      : "sms";

  const key =
    `${type}|${service || "*"}|${country || "*"}`;

  const cached = cache.offers.get(key);
  const now = Date.now();

  if (
    !fresh &&
    cached &&
    now - cached.at < OFFERS_CACHE_MS
  ) {
    return cached.value;
  }

  const payload =
    await requestRest(
      `/activations/offers/${type}`,
      {
        query: {
          services: service || undefined,
          countries:
            country !== "" &&
            country !== null &&
            country !== undefined
              ? country
              : undefined
        }
      }
    );

  const value = {
    data:
      payload?.data &&
      typeof payload.data === "object"
        ? payload.data
        : {},
    meta: payload?.meta || {}
  };

  cache.offers.set(
    key,
    {
      at: now,
      value
    }
  );

  return value;
}

export async function getVirtualNumberServices({
  fresh = false
} = {}) {
  const [services, offers] =
    await Promise.all([
      getHeroSmsServices({ fresh }),
      getHeroSmsOffers({ fresh })
    ]);

  const availableCodes =
    new Set(
      Object.keys(offers.data || {})
    );

  const byCode =
    new Map(
      services.map(
        (service) => [
          service.code,
          service
        ]
      )
    );

  const result = [];

  for (const code of availableCodes) {
    const countries =
      offers.data?.[code] || {};

    const packageCount =
      Object.values(countries)
        .filter((offer) =>
          extractProviderPrice(offer) > 0 &&
          Number(
            offer?.counts?.total || 0
          ) > 0
        )
        .length;

    if (!packageCount) {
      continue;
    }

    const known = byCode.get(code);

    result.push({
      code,
      name:
        known?.name ||
        code.toUpperCase(),
      packageCount
    });
  }

  return result.sort(
    (a, b) => {
      const priorityDiff =
        virtualNumberServicePriority(a) -
        virtualNumberServicePriority(b);

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return a.name.localeCompare(
        b.name,
        "en",
        { sensitivity: "base" }
      );
    }
  );
}

export async function getVirtualNumberPackages(
  serviceCode,
  {
    fresh = false
  } = {}
) {
  const code =
    String(serviceCode || "").trim();

  if (!code) {
    return [];
  }

  const [countries, offers] =
    await Promise.all([
      getHeroSmsCountries({ fresh }),
      getHeroSmsOffers({
        service: code,
        fresh
      })
    ]);

  const countryMap =
    new Map(
      countries.map(
        (country) => [
          String(country.id),
          country
        ]
      )
    );

  const serviceOffers =
    offers.data?.[code] || {};

  const packages = [];

  for (
    const [countryId, offer]
    of Object.entries(serviceOffers)
  ) {
    const providerPrice =
      extractProviderPrice(offer);

    const available =
      Number(
        offer?.counts?.total || 0
      );

    if (
      providerPrice <= 0 ||
      available <= 0
    ) {
      continue;
    }

    const country =
      countryMap.get(
        String(countryId)
      );

    const fallbackPresentation =
      countryPresentation(
        country?.englishName ||
        country?.name ||
        "",
        Number(countryId)
      );

    packages.push({
      serviceCode: code,
      countryId:
        Number(countryId),
      countryName:
        country?.name ||
        fallbackPresentation.name,
      countryEnglishName:
        country?.englishName || "",
      countryFlag:
        country?.flag ||
        fallbackPresentation.flag,
      countryPhoneCode:
        country?.phoneCode ||
        fallbackPresentation.phoneCode,
      countryIso2:
        country?.iso2 ||
        fallbackPresentation.iso2,
      providerPrice,
      sellingPrice:
        virtualNumberSellingPrice(
          providerPrice
        ),
      available
    });
  }

  return packages.sort(
    (a, b) =>
      a.countryName.localeCompare(
        b.countryName,
        "fa",
        { sensitivity: "base" }
      )
  );
}

export async function getVirtualNumberPackage(
  serviceCode,
  countryId,
  {
    fresh = true
  } = {}
) {
  const code =
    String(serviceCode || "").trim();

  const country =
    Number(countryId);

  const offers =
    await getHeroSmsOffers({
      service: code,
      country,
      fresh
    });

  const offer =
    offers.data?.[code]?.[
      String(country)
    ];

  if (!offer) {
    return null;
  }

  const providerPrice =
    extractProviderPrice(offer);

  const available =
    Number(
      offer?.counts?.total || 0
    );

  if (
    providerPrice <= 0 ||
    available <= 0
  ) {
    return null;
  }

  const countries =
    await getHeroSmsCountries();

  const countryInfo =
    countries.find(
      (item) =>
        Number(item.id) === country
    );

  const fallbackPresentation =
    countryPresentation(
      countryInfo?.englishName ||
      countryInfo?.name ||
      "",
      country
    );

  return {
    serviceCode: code,
    countryId: country,
    countryName:
      countryInfo?.name ||
      fallbackPresentation.name,
    countryEnglishName:
      countryInfo?.englishName || "",
    countryFlag:
      countryInfo?.flag ||
      fallbackPresentation.flag,
    countryPhoneCode:
      countryInfo?.phoneCode ||
      fallbackPresentation.phoneCode,
    countryIso2:
      countryInfo?.iso2 ||
      fallbackPresentation.iso2,
    providerPrice,
    sellingPrice:
      virtualNumberSellingPrice(
        providerPrice
      ),
    available
  };
}

export async function buyVirtualNumber({
  serviceCode,
  countryId,
  providerPrice
}) {
  const maxPrice = Number(providerPrice);
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    throw new HeroSmsApiError(
      "Invalid provider price",
      { code: "WRONG_MAX_PRICE" }
    );
  }

  const payload =
    await requestRest(
      "/activations",
      {
        method: "POST",
        body: {
          service:
            String(serviceCode),
          country:
            Number(countryId),
          amount: 1,
          fixedPrice: true,
          maxPrice,
          verificationType: "sms"
        }
      }
    );

  const activation =
    Array.isArray(payload?.data)
      ? payload.data[0]
      : null;

  if (!activation?.id) {
    throw new HeroSmsApiError(
      "HeroSMS returned no activation",
      {
        code: "invalid_response",
        payload
      }
    );
  }

  return activation;
}

export async function getVirtualNumberLastOtp(
  activationId
) {
  const payload =
    await requestRest(
      `/activations/${encodeURIComponent(
        String(activationId)
      )}/otp/last`
    );

  return payload?.data || null;
}

export async function getVirtualNumberOtpList(
  activationId
) {
  const payload =
    await requestRest(
      `/activations/${encodeURIComponent(
        String(activationId)
      )}/otp`
    );

  return Array.isArray(payload?.data)
    ? payload.data
    : [];
}

export async function cancelVirtualNumber(
  activationId
) {
  return requestRest(
    `/activations/${encodeURIComponent(
      String(activationId)
    )}`,
    { method: "DELETE" }
  );
}

export async function finishVirtualNumber(
  activationId
) {
  return requestRest(
    `/activations/${encodeURIComponent(
      String(activationId)
    )}/finish`,
    { method: "POST" }
  );
}
