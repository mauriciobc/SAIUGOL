/**
 * Fixture de partidas para testes de timezone e detecção de estado.
 * Estrutura normalizada idêntica à retornada por getTodayMatches (ESPN).
 */
export const matchScheduleFixture = [
    {
        id: '1',
        homeTeam: { id: '100', name: 'Time A' },
        awayTeam: { id: '101', name: 'Time B' },
        homeScore: 0,
        awayScore: 0,
        status: 'scheduled',
        state: 'pre',
        venue: 'Estádio X',
        startTime: '2026-02-12T22:00:00Z',
        minute: '',
    },
    {
        id: '2',
        homeTeam: { id: '102', name: 'Time C' },
        awayTeam: { id: '103', name: 'Time D' },
        homeScore: 1,
        awayScore: 1,
        status: '1st Half',
        state: 'in',
        venue: 'Estádio Y',
        startTime: '2026-02-12T19:00:00Z',
        minute: "32'",
    },
    {
        id: '3',
        homeTeam: { id: '104', name: 'Time E' },
        awayTeam: { id: '105', name: 'Time F' },
        homeScore: 2,
        awayScore: 1,
        status: 'finished',
        state: 'post',
        venue: 'Estádio Z',
        startTime: '2026-02-12T17:00:00Z',
        minute: "90'",
    },
];
