/**
 * Script para testes: imprime config.timezone (e data no timezone) para validar env.
 * Deve ser executado com spawn e env controlado (TIMEZONE/TZ).
 */
import { config } from '../../src/config.js';

const tz = config.timezone || 'UTC';
const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
const dateStr = formatter.format(new Date()).replace(/-/g, '');

console.log(JSON.stringify({ timezone: config.timezone, dateStr }));
