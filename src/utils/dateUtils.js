/**
 * Date formatting utilities for timezone-aware YYYYMMDD.
 * Extracted for testability (pure function accepts arbitrary date).
 *
 * @module utils/dateUtils
 */

/**
 * Format a date as YYYYMMDD in the given timezone.
 * @param {Date} date - The date to format
 * @param {string} timezone - IANA timezone (e.g. 'America/Sao_Paulo', 'UTC')
 * @returns {string} YYYYMMDD (e.g. '20260212')
 * @throws {TypeError} If date is null, undefined, not a Date, or invalid (NaN)
 */
export function getDateStringFor(date, timezone) {
    if (date == null) {
        throw new TypeError(`getDateStringFor: date is ${String(date)}`);
    }
    if (!(date instanceof Date)) {
        throw new TypeError(`getDateStringFor: date must be a Date instance, got ${typeof date}`);
    }
    if (Number.isNaN(date.getTime())) {
        throw new TypeError('getDateStringFor: invalid date (NaN)');
    }

    let tz = String(timezone || 'UTC').trim() || 'UTC';
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        return formatter.format(date).replace(/-/g, '');
    } catch {
        tz = 'UTC';
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        return formatter.format(date).replace(/-/g, '');
    }
}
