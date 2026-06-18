import { describe, it, expect } from '@jest/globals';
import {
  PersonaTemplateSchema,
  renderSystemPrompt,
  type PersonaTemplate,
} from './persona-prompt.template';

const base: PersonaTemplate = {
  customerProfile: 'Premium subscriber for 3 years',
  company: 'Nimbus Telecom',
  issue: 'charged twice for this month bill',
  channel: 'chat',
  emotion: 'frustrated',
  intensity: 4,
  desiredOutcome: 'a refund of the duplicate charge',
  resolutionCriteria: 'the agent confirms the duplicate charge will be refunded',
};

describe('PersonaTemplateSchema', () => {
  it('accepts a minimal valid template and defaults channel to chat', () => {
    const { channel: _channel, ...withoutChannel } = base;
    const parsed = PersonaTemplateSchema.parse(withoutChannel);
    expect(parsed.channel).toBe('chat');
  });

  it('rejects an empty issue', () => {
    expect(() => PersonaTemplateSchema.parse({ ...base, issue: '' })).toThrow();
  });

  it('rejects intensity outside 1–5', () => {
    expect(() => PersonaTemplateSchema.parse({ ...base, intensity: 6 })).toThrow();
    expect(() => PersonaTemplateSchema.parse({ ...base, intensity: 0 })).toThrow();
  });

  it('rejects an unknown emotion', () => {
    expect(() =>
      PersonaTemplateSchema.parse({ ...base, emotion: 'ecstatic' }),
    ).toThrow();
  });
});

describe('renderSystemPrompt', () => {
  it('always includes the in-character guardrails and the end sentinel', () => {
    const prompt = renderSystemPrompt(base);
    expect(prompt).toContain('never reveal that you are an AI');
    expect(prompt).toContain('[CONVERSATION_ENDED]');
  });

  it('injects the required fields verbatim', () => {
    const prompt = renderSystemPrompt(base);
    expect(prompt).toContain('Nimbus Telecom');
    expect(prompt).toContain('charged twice for this month bill');
    expect(prompt).toContain('a refund of the duplicate charge');
    expect(prompt).toContain('the agent confirms the duplicate charge will be refunded');
    expect(prompt).toContain('frustrated');
    expect(prompt).toContain('4 out of 5');
  });

  it('omits optional sections when their fields are absent', () => {
    const prompt = renderSystemPrompt(base);
    expect(prompt).not.toContain('Information you hold back');
    expect(prompt).not.toContain('Additional direction');
    expect(prompt).not.toContain('Your name is');
  });

  it('includes optional sections when their fields are present', () => {
    const prompt = renderSystemPrompt({
      ...base,
      customerName: 'Dana',
      hiddenDetails: 'you switched plans mid-cycle',
      additionalInstructions: 'mention you are short on time',
    });
    expect(prompt).toContain('Your name is Dana.');
    expect(prompt).toContain('Information you hold back');
    expect(prompt).toContain('you switched plans mid-cycle');
    expect(prompt).toContain('Additional direction');
    expect(prompt).toContain('mention you are short on time');
  });

  it('uses chat-style guidance for the chat channel', () => {
    const prompt = renderSystemPrompt({ ...base, channel: 'chat' });
    expect(prompt).toContain('live text chat');
    expect(prompt).not.toContain('spoken phone call');
  });

  it('uses spoken guidance for the audio channel', () => {
    const prompt = renderSystemPrompt({ ...base, channel: 'audio' });
    expect(prompt).toContain('spoken phone call');
    expect(prompt).not.toContain('live text chat');
  });
});
