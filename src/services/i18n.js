import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Translation cache
const translationCache = new Map();

// Loaded dictionaries
const dictionaries = new Map();

// Default language
let currentLanguage = 'pt-BR';

/**
 * Load a dictionary file for a specific language
 * @param {string} lang - Language code (e.g., 'pt-BR')
 * @returns {Object|null} Dictionary object or null if failed
 */
function loadDictionary(lang) {
    try {
        const dictionaryPath = path.join(__dirname, 'dictionaries', `${lang}.json`);
        const content = fs.readFileSync(dictionaryPath, 'utf8');
        const dictionary = JSON.parse(content);
        logger.info({ lang, path: dictionaryPath }, 'Dictionary loaded successfully');
        return dictionary;
    } catch (error) {
        logger.warn({ lang, error: error.message }, 'Failed to load dictionary');
        return null;
    }
}

/**
 * Initialize the translation system
 * @param {string} lang - Default language code
 */
export function initI18n(lang = 'pt-BR') {
    currentLanguage = lang;

    // Load the specified language dictionary
    const dictionary = loadDictionary(lang);
    if (dictionary) {
        dictionaries.set(lang, dictionary);
        logger.info({ lang }, 'Translation system initialized');
    } else {
        logger.error({ lang }, 'Failed to initialize translation system - dictionary not found');
    }
}

/**
 * Get a value from a nested object using dot notation
 * @param {Object} obj - Object to search
 * @param {string} path - Dot-separated path (e.g., 'ui.goal_announcement')
 * @returns {any} Value at path or undefined
 */
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Replace variables in a string template
 * @param {string} template - Template string with {{variable}} placeholders
 * @param {Object} variables - Object with variable values
 * @returns {string} Resolved string
 */
function replaceVariables(template, variables = {}) {
    if (!template || typeof template !== 'string') {
        return template;
    }

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return variables[key] !== undefined ? variables[key] : match;
    });
}

/**
 * Translate a key to the current language
 * @param {string} key - Translation key (e.g., 'ui.goal_announcement')
 * @param {Object} variables - Optional variables to replace in template
 * @param {string} lang - Optional language override
 * @returns {string} Translated string or the key itself if not found
 */
export function translate(key, variables = {}, lang = currentLanguage) {
    // Check cache first
    const cacheKey = `${lang}:${key}:${JSON.stringify(variables)}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
    }

    // Get dictionary
    let dictionary = dictionaries.get(lang);

    // Load dictionary if not already loaded
    if (!dictionary) {
        dictionary = loadDictionary(lang);
        if (dictionary) {
            dictionaries.set(lang, dictionary);
        }
    }

    // Get translation
    let translation = dictionary ? getNestedValue(dictionary, key) : undefined;

    // Fallback to key if not found
    if (translation === undefined) {
        logger.debug({ key, lang }, 'Translation key not found');
        translation = key;
    }

    // Replace variables
    const result = replaceVariables(translation, variables);

    // Cache the result
    translationCache.set(cacheKey, result);

    return result;
}

/**
 * Translate an event type
 * @param {string} eventType - Event type from ESPN API (e.g., 'Goal - Header')
 * @param {string} lang - Optional language override
 * @returns {string} Translated event type
 */
export function translateEventType(eventType, lang = currentLanguage) {
    if (!eventType) {
        return translate('common.unknown', {}, lang);
    }

    // Normalize the event type (lowercase, trim)
    const normalized = eventType.toLowerCase().trim();

    // Try to find translation in events section
    const key = `events.${normalized}`;
    const translated = translate(key, {}, lang);

    // If translation is the same as key, it wasn't found - return original
    if (translated === key) {
        logger.debug({ eventType }, 'Event type translation not found, using original');
        return eventType;
    }

    return translated;
}

/**
 * Set the current language
 * @param {string} lang - Language code
 */
export function setLanguage(lang) {
    currentLanguage = lang;
    logger.info({ lang }, 'Language changed');
}

/**
 * Get the current language
 * @returns {string} Current language code
 */
export function getLanguage() {
    return currentLanguage;
}

/**
 * Clear the translation cache
 */
export function clearCache() {
    translationCache.clear();
    logger.info('Translation cache cleared');
}
