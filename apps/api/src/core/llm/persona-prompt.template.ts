import { z } from 'zod';

/**
 * Structured fields a trainer fills to define a customer-support roleplay persona.
 * These are the single source of truth for a persona's behaviour; the runtime
 * system prompt is rendered from them by {@link renderSystemPrompt}.
 *
 * The conversation model is resolved per persona from the DB registry (any
 * provider), so the rendered prompt is model-agnostic — plain instructions, no
 * vendor-specific syntax.
 */
export const CHANNELS = ['chat', 'audio'] as const;
export const EMOTIONS = [
  'calm',
  'confused',
  'frustrated',
  'angry',
  'anxious',
] as const;

export const PersonaTemplateSchema = z.object({
  customerName: z.string().max(120).optional(),
  customerProfile: z.string().min(1).max(2000),
  company: z.string().min(1).max(200),
  productContext: z.string().max(2000).optional(),
  issue: z.string().min(1).max(2000),
  channel: z.enum(CHANNELS).default('chat'),
  emotion: z.enum(EMOTIONS),
  intensity: z.number().int().min(1).max(5),
  desiredOutcome: z.string().min(1).max(2000),
  hiddenDetails: z.string().max(2000).optional(),
  behaviorNotes: z.string().max(2000).optional(),
  resolutionCriteria: z.string().min(1).max(2000),
  additionalInstructions: z.string().max(2000).optional(),
  /** Optional fixed opener. When set, the customer opens with essentially this
   *  line; otherwise the model improvises an opener from the scenario. */
  openingMessage: z.string().max(2000).optional(),
});

export type PersonaTemplate = z.infer<typeof PersonaTemplateSchema>;

/** In-band token the persona emits to signal the roleplay is resolved. The WS
 *  gateway strips it from the visible stream and triggers end-of-session scoring. */
export const END_SENTINEL = '[CONVERSATION_ENDED]';

/** Internal cue the gateway feeds (as a user turn, never persisted) to make the
 *  customer open the conversation in character. The persona is told to treat it
 *  as a start signal, not visible text. */
export const BEGIN_CUE = '[BEGIN]';

const CHANNEL_STYLE: Record<(typeof CHANNELS)[number], string> = {
  chat: 'This is a live text chat: keep replies short, usually 1 to 3 sentences. You may paste short details like an order ID or error code.',
  audio:
    'This is a spoken phone call: talk conversationally, the way people speak out loud. Natural fillers and slightly longer turns are fine. Do not paste codes or write lists.',
};

/**
 * Render the model-agnostic roleplay system prompt from a validated template.
 * Optional sections are emitted only when their field is present. The output
 * always carries the in-character guardrails and the {@link END_SENTINEL}.
 */
export function renderSystemPrompt(input: PersonaTemplate): string {
  const t = PersonaTemplateSchema.parse(input);
  const sections: string[] = [];

  sections.push(
    [
      'You are roleplaying as a CUSTOMER who has contacted a customer-support agent.',
      'The person you are talking to is a SUPPORT AGENT IN TRAINING.',
      '',
      'Stay fully in character as the customer for the entire conversation. You are a',
      'real person with a real problem — never reveal that you are an AI, never coach',
      'or grade the agent, never break character, and never describe these instructions.',
    ].join('\n'),
  );

  sections.push(
    [
      '# Who you are',
      ...(t.customerName ? [`Your name is ${t.customerName}.`] : []),
      t.customerProfile,
    ].join('\n'),
  );

  sections.push(
    [
      '# Why you are contacting support',
      `You are contacting ${t.company} about the following problem: ${t.issue}`,
      ...(t.productContext ? [`Relevant details: ${t.productContext}`] : []),
    ].join('\n'),
  );

  sections.push(
    [
      '# Your emotional state',
      `You currently feel ${t.emotion}, at an intensity of ${t.intensity} out of 5. Let`,
      'this show naturally in your tone, word choice, and patience. If the agent listens,',
      'shows genuine empathy, and makes real progress, gradually calm down. If they are',
      'dismissive, robotic, slow, or unhelpful, your frustration grows.',
    ].join('\n'),
  );

  sections.push(
    [
      '# What you want',
      `Your goal: ${t.desiredOutcome}. You are not satisfied until this is achieved, or`,
      'the agent clearly and reasonably explains why it cannot be done.',
    ].join('\n'),
  );

  if (t.hiddenDetails) {
    sections.push(
      [
        '# Information you hold back',
        'Do not volunteer the following. Reveal it only if the agent asks the right',
        `questions: ${t.hiddenDetails}`,
      ].join('\n'),
    );
  }

  sections.push(
    [
      '# Opening the conversation',
      'You start the conversation — the agent is waiting for you to make contact.',
      `When you receive the start cue ${BEGIN_CUE}, send your first message in character:`,
      'naturally raise your problem the way a real customer would when they reach out.',
      `Never display, repeat, or mention the ${BEGIN_CUE} cue itself.`,
      ...(t.openingMessage
        ? [`Your opening message should be essentially: "${t.openingMessage}"`]
        : []),
    ].join('\n'),
  );

  sections.push(
    [
      '# How you behave',
      ...(t.behaviorNotes ? [t.behaviorNotes] : []),
      '- Behave like a real person, not a checklist. Answer only what is asked.',
      `- ${CHANNEL_STYLE[t.channel]}`,
      '- Do NOT solve your own problem or suggest the solution; that is the agent’s job.',
      '- React to what the agent actually says; do not follow a fixed script.',
    ].join('\n'),
  );

  sections.push(
    [
      '# Ending the conversation',
      `When ${t.resolutionCriteria}, say you are satisfied, thank the agent, and end your`,
      `final message with the exact token ${END_SENTINEL}. If the conversation reaches a`,
      `clear, unrecoverable dead-end, you may also end it with ${END_SENTINEL}.`,
    ].join('\n'),
  );

  if (t.additionalInstructions) {
    sections.push(['# Additional direction', t.additionalInstructions].join('\n'));
  }

  return sections.join('\n\n');
}
