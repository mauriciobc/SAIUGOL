import 'dotenv/config';

export const config = {
    mastodon: {
        instance: process.env.MASTODON_INSTANCE || 'https://mastodon.social',
        accessToken: process.env.MASTODON_ACCESS_TOKEN,
    },
    // ESPN API configuration (No key required)
    espn: {
        baseUrl: 'https://site.api.espn.com/apis/site/v2/sports/soccer',
        league: 'bra.1',
    },
    bot: {
        pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS, 10) || 60000,
        dryRun: process.env.DRY_RUN === 'true',
        // Brasileirão Serie A identifiers
        countryCode: 'BR',
        leagueName: 'Serie A',
    },
    // Event types to post
    events: {
        goals: true,
        yellowCards: true,
        redCards: true,
        substitutions: true,
        varReviews: true,
        matchStart: true,
        matchEnd: true,
    },
    // Hashtags for posts
    hashtags: ['#Brasileirão', '#SerieA', '#FutebolBrasileiro'],
};
