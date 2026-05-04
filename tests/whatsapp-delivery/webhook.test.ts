import { describe, expect, it } from 'vitest';
import {
  parseInboundMessage,
  parseStatusCallback,
  verifyTwilioSignature,
  WebhookSignatureError,
} from '../../src/whatsapp-delivery/index.js';
import { _internal } from '../../src/whatsapp-delivery/webhook.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import twilio from 'twilio';

function configWith(authToken: string | undefined): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    logLevel: 'error',
    publicBaseUrl: undefined,
    databaseUrl: undefined,
    redisUrl: undefined,
    upstashRedisRestUrl: undefined,
    upstashRedisRestToken: undefined,
    encryptionKeyBase64: undefined,
    jwtSecretBase64: undefined,
    jwtIssuer: undefined,
    jwtAudience: undefined,
    anthropicApiKey: undefined,
    groqApiKey: undefined,
    voyageApiKey: undefined,
    twilioAccountSid: undefined,
    twilioAuthToken: authToken,
    twilioWhatsAppFrom: undefined,
    twilioWebhookAuthToken: undefined,
    sentryDsn: undefined,
    axiomToken: undefined,
    axiomDataset: undefined,
    betterstackHeartbeatUrl: undefined,
  };
}

describe('parseInboundMessage', () => {
  it('extracts E164 from whatsapp: prefix', () => {
    const ev = parseInboundMessage({
      From: 'whatsapp:+252612345678',
      MessageSid: 'SM123',
      Body: 'hello',
      NumMedia: '0',
    });
    if (ev.kind !== 'inbound') {
      throw new Error('expected inbound');
    }
    expect(ev.fromE164).toBe('+252612345678');
    expect(ev.waMessageId).toBe('SM123');
    expect(ev.body).toBe('hello');
    expect(ev.mediaUrls).toEqual([]);
  });

  it('collects MediaUrl0..N for attachments', () => {
    const ev = parseInboundMessage({
      From: 'whatsapp:+252612345678',
      MessageSid: 'SM123',
      Body: 'see attached',
      NumMedia: '2',
      MediaUrl0: 'https://m.example/a.jpg',
      MediaUrl1: 'https://m.example/b.jpg',
    });
    if (ev.kind !== 'inbound') {
      throw new Error('expected inbound');
    }
    expect(ev.mediaUrls).toEqual(['https://m.example/a.jpg', 'https://m.example/b.jpg']);
  });
});

describe('parseStatusCallback', () => {
  it('parses delivered status', () => {
    const ev = parseStatusCallback({
      MessageSid: 'SM123',
      MessageStatus: 'delivered',
    });
    if (ev.kind !== 'status') {
      throw new Error('expected status');
    }
    expect(ev.status).toBe('delivered');
    expect(ev.errorCode).toBeUndefined();
  });

  it('parses failed status with error code', () => {
    const ev = parseStatusCallback({
      MessageSid: 'SM123',
      MessageStatus: 'failed',
      ErrorCode: '63016',
    });
    if (ev.kind !== 'status') {
      throw new Error('expected status');
    }
    expect(ev.status).toBe('failed');
    expect(ev.errorCode).toBe('63016');
  });
});

describe('STATUS_RANK precedence', () => {
  it('ranks delivered > sent > queued', () => {
    expect(_internal.STATUS_RANK['delivered']!).toBeGreaterThan(_internal.STATUS_RANK['sent']!);
    expect(_internal.STATUS_RANK['sent']!).toBeGreaterThan(_internal.STATUS_RANK['queued']!);
  });

  it('ranks read > delivered (read is the highest non-failure)', () => {
    expect(_internal.STATUS_RANK['read']!).toBeGreaterThan(_internal.STATUS_RANK['delivered']!);
  });
});

describe('verifyTwilioSignature', () => {
  const url = 'https://example.com/webhooks/twilio/inbound';
  const params = { From: 'whatsapp:+252612345678', Body: 'hi', MessageSid: 'SM123' };

  it('accepts a signature that Twilio.getExpectedTwilioSignature would have produced', () => {
    const authToken = 'test-token-abc-123';
    // The same algorithm the SDK uses internally; we re-derive to compute a
    // known-good signature for this fixture.
    const sig = twilio.getExpectedTwilioSignature(authToken, url, params);
    expect(() => verifyTwilioSignature(configWith(authToken), sig, url, params)).not.toThrow();
  });

  it('rejects a tampered signature', () => {
    const authToken = 'test-token-abc-123';
    const sig = twilio.getExpectedTwilioSignature(authToken, url, params);
    const tampered = sig.slice(0, -2) + 'AA';
    expect(() => verifyTwilioSignature(configWith(authToken), tampered, url, params)).toThrow(
      WebhookSignatureError,
    );
  });

  it('rejects a missing signature header', () => {
    expect(() => verifyTwilioSignature(configWith('any-token'), undefined, url, params)).toThrow(
      WebhookSignatureError,
    );
  });

  it('rejects when the auth token is unconfigured', () => {
    expect(() => verifyTwilioSignature(configWith(undefined), 'any', url, params)).toThrow(
      WebhookSignatureError,
    );
  });
});
