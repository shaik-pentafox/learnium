import { describe, it, expect } from '@jest/globals';
import {
  PersonaTemplateSchema,
  renderSystemPrompt,
  type PersonaTemplateInput,
} from './persona-prompt.template';

const base: PersonaTemplateInput = {
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

  it('always instructs the customer to open on the BEGIN cue', () => {
    const prompt = renderSystemPrompt(base);
    expect(prompt).toContain('Opening the conversation');
    expect(prompt).toContain('[BEGIN]');
    expect(prompt).toContain('You start the conversation');
  });

  it('pins the opener when openingMessage is provided, omits it otherwise', () => {
    expect(renderSystemPrompt(base)).not.toContain('opening message should be');
    const pinned = renderSystemPrompt({
      ...base,
      openingMessage: 'Hi, I was charged twice and need a refund.',
    });
    expect(pinned).toContain(
      'Your opening message should be essentially: "Hi, I was charged twice and need a refund."',
    );
  });
});

describe('renderSystemPrompt — adopted fields (customer-support)', () => {
  it('omits the gender line when gender is absent', () => {
    const parsed = PersonaTemplateSchema.parse(base);
    expect(parsed.gender).toBeUndefined();
    expect(renderSystemPrompt(base)).not.toContain('keep your pronouns');
  });

  it('renders gender and age when provided', () => {
    const male = renderSystemPrompt({ ...base, gender: 'male' });
    expect(male).toContain('You are a man');
    const female = renderSystemPrompt({ ...base, gender: 'female', customerAge: 34 });
    expect(female).toContain('You are a woman');
    expect(female).toContain('You are 34 years old.');
  });

  it('renders verifiable contact / account details only when present', () => {
    expect(renderSystemPrompt(base)).not.toContain('verify your identity');
    const prompt = renderSystemPrompt({
      ...base,
      customerContact: '+1 555 0100',
      accountRef: 'ORD-9931',
    });
    expect(prompt).toContain('verify your identity');
    expect(prompt).toContain('+1 555 0100');
    expect(prompt).toContain('ORD-9931');
  });

  it('renders escalation / de-escalation triggers when present', () => {
    const prompt = renderSystemPrompt({
      ...base,
      escalationTriggers: 'the agent puts you on hold again',
      deescalationTriggers: 'the agent apologises sincerely',
    });
    expect(prompt).toContain('more upset when: the agent puts you on hold again');
    expect(prompt).toContain('calm down when: the agent apologises sincerely');
  });

  it('folds the closing statement into the ending, before the sentinel', () => {
    const prompt = renderSystemPrompt({
      ...base,
      closingStatement: 'Thanks, that sorts it out.',
    });
    expect(prompt).toContain('sign off with essentially: "Thanks, that sorts it out."');
    expect(prompt).toContain('[CONVERSATION_ENDED]');
  });

  it('defaults domain to customer-support', () => {
    expect(PersonaTemplateSchema.parse(base).domain).toBe('customer-support');
  });
});
