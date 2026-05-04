import { describe, expect, it } from 'vitest';
import {
  validateOutboundRequest,
  WhatsAppRequestValidationError,
} from '../../src/whatsapp-delivery/index.js';

const baseFreeForm = {
  correlationId: 'abc-123',
  callerProcessId: 'test',
  phoneE164: '+252612345678',
  messageType: 'FreeForm',
  priority: 'Normal',
  body: 'hi',
};

const baseTemplate = {
  correlationId: 'abc-123',
  callerProcessId: 'test',
  phoneE164: '+252612345678',
  messageType: 'Template',
  priority: 'Normal',
  templateName: 'sandbox_echo',
  templateParams: ['hello'],
};

describe('validateOutboundRequest', () => {
  it('accepts a well-formed FreeForm request', () => {
    const r = validateOutboundRequest(baseFreeForm);
    expect(r.correlationId).toBe('abc-123');
  });

  it('accepts a well-formed Template request', () => {
    const r = validateOutboundRequest(baseTemplate);
    expect(r.messageType).toBe('Template');
  });

  it('rejects a missing correlationId', () => {
    const bad = { ...baseFreeForm, correlationId: '' };
    expect(() => validateOutboundRequest(bad)).toThrow(WhatsAppRequestValidationError);
  });

  it('rejects a non-E164 phoneE164', () => {
    const bad = { ...baseFreeForm, phoneE164: '0612345678' };
    expect(() => validateOutboundRequest(bad)).toThrow(WhatsAppRequestValidationError);
  });

  it('rejects an invalid messageType', () => {
    const bad = { ...baseFreeForm, messageType: 'Voice' };
    expect(() => validateOutboundRequest(bad)).toThrow(WhatsAppRequestValidationError);
  });

  it('rejects an invalid priority', () => {
    const bad = { ...baseFreeForm, priority: 'Urgent' };
    expect(() => validateOutboundRequest(bad)).toThrow(WhatsAppRequestValidationError);
  });

  it('rejects FreeForm with empty body', () => {
    const bad = { ...baseFreeForm, body: '' };
    expect(() => validateOutboundRequest(bad)).toThrow(WhatsAppRequestValidationError);
  });

  it('rejects FreeForm body over 1600 chars', () => {
    const bad = { ...baseFreeForm, body: 'x'.repeat(1700) };
    expect(() => validateOutboundRequest(bad)).toThrow(WhatsAppRequestValidationError);
  });

  it('rejects Template missing templateName', () => {
    const bad = { ...baseTemplate, templateName: '' };
    expect(() => validateOutboundRequest(bad)).toThrow(WhatsAppRequestValidationError);
  });

  it('rejects Template with non-string params', () => {
    const bad = { ...baseTemplate, templateParams: [123] };
    expect(() => validateOutboundRequest(bad)).toThrow(WhatsAppRequestValidationError);
  });

  it('rejects null', () => {
    expect(() => validateOutboundRequest(null)).toThrow(WhatsAppRequestValidationError);
  });
});
