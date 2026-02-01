import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { postStatus, postThread, verifyCredentials, __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';

describe('Mastodon API', () => {
    let mockClient;

    beforeEach(() => {
        // Reset mock client before each test
        mockClient = {
            postStatus: async () => { },
            verifyAccountCredentials: async () => { },
        };
        __setClient(mockClient);
    });

    test('verifyCredentials should return true on success', async () => {
        mockClient.verifyAccountCredentials = async () => ({
            data: { username: 'testuser' }
        });

        const result = await verifyCredentials();
        assert.strictEqual(result, true);
    });

    test('verifyCredentials should return false on error', async () => {
        mockClient.verifyAccountCredentials = async () => {
            throw new Error('Unauthorized');
        };

        const result = await verifyCredentials();
        assert.strictEqual(result, false);
    });

    test('postStatus should call client.postStatus and return data', async () => {
        const testText = 'Hello Mastodon';
        mockClient.postStatus = async (text, options) => {
            assert.strictEqual(text, testText);
            return { data: { id: '123', content: text } };
        };

        const result = await postStatus(testText);
        assert.strictEqual(result.id, '123');
    });

    test('postStatus should return null on error', async () => {
        mockClient.postStatus = async () => {
            throw new Error('Network error');
        };

        const result = await postStatus('fail');
        assert.strictEqual(result, null);
    });

    test('postThread should post multiple items and chain IDs', async () => {
        const texts = ['Post 1', 'Post 2'];
        let callCount = 0;

        mockClient.postStatus = async (text, options) => {
            callCount++;
            if (callCount === 2) {
                assert.strictEqual(options.in_reply_to_id, 'p1');
            }
            return { data: { id: `p${callCount}`, content: text } };
        };

        const results = await postThread(texts);
        assert.strictEqual(results.length, 2);
        assert.strictEqual(results[0].id, 'p1');
        assert.strictEqual(results[1].id, 'p2');
    });

    test('postStatus should handle dryRun mode without client', async () => {
        const originalDryRun = config.bot.dryRun;
        config.bot.dryRun = true;

        // Even if client is broken, dryRun shouldn't call it
        mockClient.postStatus = () => { throw new Error('Should not be called'); };

        const result = await postStatus('dry run test');
        assert.strictEqual(result.id, 'dry-run');

        config.bot.dryRun = originalDryRun;
    });
});
