import { CATALOG } from './catalog.js';
import { lookupCountryMeta, lookupHeroCountryById } from '../providers/virtual_number/countries.js';

export const LANGUAGES = [
  { code: 'en', label: '🇬🇧 English', prompt: 'Please choose your language.' },
  { code: 'zh', label: '🇨🇳 中文（普通话）', prompt: '请选择您的语言。' },
  { code: 'ru', label: '🇷🇺 Русский', prompt: 'Пожалуйста, выберите язык.' },
  { code: 'fa', label: '🇮🇷 فارسی', prompt: 'لطفاً زبان خود را انتخاب کنید.' },
  { code: 'ar', label: '🇸🇦 العربية', prompt: 'يرجى اختيار لغتك.' },
  { code: 'fr', label: '🇫🇷 Français', prompt: 'Veuillez choisir votre langue.' }
];
export const isLanguage = (code) => LANGUAGES.some((item) => item.code === code);
export const languagePrompt = () => LANGUAGES.map((item) => item.prompt).join('\n\n');
export const languageKeyboard = () => ({ inline_keyboard: LANGUAGES.map((item) => [
  { text: item.label, callback_data: `language:select:${item.code}` }
]) });

const countryEntries = new Map();
const englishRegions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const regions = new Map(LANGUAGES.map(({ code }) => [code,
  new Intl.DisplayNames([code === 'zh' ? 'zh-Hans' : code], { type: 'region', fallback: 'none' })
]));
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const iso = String.fromCharCode(a, b);
    if (!lookupCountryMeta(iso)) continue;
    const name = englishRegions.of(iso);
    if (name) countryEntries.set(name, iso);
  }
}
for (let id = 0; id < 300; id++) {
  const country = lookupHeroCountryById(id);
  if (country?.iso2) countryEntries.set(country.name, country.iso2);
}
// Common names used by catalogue providers, in addition to ISO display names.
for (const [name, iso] of Object.entries({ USA:'US', UK:'GB', England:'GB', Korea:'KR',
  'South Korea':'KR', Russia:'RU', Vietnam:'VN', Turkey:'TR', Taiwan:'TW',
  'United States of America':'US', 'Czech Republic':'CZ', 'UAE':'AE' })) {
  countryEntries.set(name, iso);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lookup = new Map(Object.entries(CATALOG).map(([source, values]) => [source.toLowerCase(), values]));
for (const [name, iso] of countryEntries) {
  lookup.set(name.toLowerCase(), Object.fromEntries(LANGUAGES.map(({code}) => [code, regions.get(code).of(iso) || name])));
}
const keys = [...lookup.keys()].sort((a, b) => b.length - a.length);
// A single replacement pass prevents translating the translated output again.
const matcher = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${keys.map(escapeRe).join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'giu');
// User data and machine-readable values must not be translated. The full contents
// of code/pre blocks, HTML attributes, links, commands, and handles stay intact.
const protectedParts = /(<code\b[^>]*>[\s\S]*?<\/code>|<pre\b[^>]*>[\s\S]*?<\/pre>|<[^>]+>|https?:\/\/[^\s<>]+|(?:^|\s)@[\w]+|(?:^|\s)\/[a-z][a-z0-9_]*(?:@[\w]+)?|&(?:#\d+|#x[\da-f]+|\w+);)/gi;

export function translateText(value, language = 'fa') {
  if (typeof value !== 'string' || !value || value === 'language') return value;
  const lang = isLanguage(language) ? language : 'fa';
  return value.split(protectedParts).map((part, index) => {
    if (index % 2) return part;
    return part.replace(/\\n/g, '\n').replace(matcher, (source) => lookup.get(source.toLowerCase())?.[lang] ?? source);
  }).join('');
}

const MENU_SOURCE = [
  'لیست محصولات', 'Certificate آیفون / آیپد', 'Certificate آیفون', 'شماره مجازی',
  'سفارش‌های من', 'کیف پول', 'افزایش موجودی', 'پشتیبانی', 'قیمت بسته‌ها'
];
const menuAliases = new Map();
for (const source of MENU_SOURCE) {
  for (const { code } of LANGUAGES) menuAliases.set(translateText(source, code), source);
  menuAliases.set(source, source);
}
// Translate only recognised menu selections on input; never touch UDIDs, links,
// OTPs, quantities or customer-supplied comments.
export const canonicalMenuText = (text) => menuAliases.get(text) ?? text;

function translateMarkup(markup, language) {
  if (!markup) return markup;
  const result = { ...markup };
  for (const key of ['inline_keyboard', 'keyboard']) {
    if (!Array.isArray(markup[key])) continue;
    result[key] = markup[key].map((row) => row.map((button) => {
      if (typeof button === 'string') return translateText(button, language);
      if (!button || typeof button !== 'object') return button;
      const translated = { ...button };
      if (!button.callback_data?.startsWith('language:select:')) {
        translated.text = translateText(button.text, language);
      }
      return translated;
    }));
  }
  if (typeof result.input_field_placeholder === 'string') {
    result.input_field_placeholder = translateText(result.input_field_placeholder, language);
  }
  return result;
}

export function localizePayload(method, payload, language) {
  const result = { ...payload };
  const picker = result._afplay_language_picker;
  delete result._afplay_language_picker;
  if (picker) return result;
  for (const field of ['text', 'caption', 'question', 'explanation']) {
    if (typeof result[field] !== 'string') continue;
    // Current UI uses HTML. If an integration supplies explicit entity offsets,
    // keep the text intact instead of corrupting those offsets.
    if ((field === 'text' && result.entities?.length) ||
        (field === 'caption' && result.caption_entities?.length)) continue;
    result[field] = translateText(result[field], language);
  }
  if (method === 'answerCallbackQuery' && result.text) {
    result.text = [...result.text].slice(0, 200).join('');
  }
  result.reply_markup = translateMarkup(result.reply_markup, language);
  return result;
}

const installed = Symbol('afplayLocalizedApi');
export function attachLocalizedApi(telegram, resolveLanguage) {
  if (telegram[installed]) return;
  telegram[installed] = true;
  const original = telegram.callApi.bind(telegram);
  telegram.callApi = async (method, payload = {}, ...rest) => {
    const needsLanguage = payload.text !== undefined || payload.caption !== undefined || payload.reply_markup;
    if (!needsLanguage || payload._afplay_language_picker) {
      const next = { ...payload };
      delete next._afplay_language_picker;
      return original(method, next, ...rest);
    }
    const language = await resolveLanguage(payload);
    return original(method, localizePayload(method, payload, language), ...rest);
  };
}
