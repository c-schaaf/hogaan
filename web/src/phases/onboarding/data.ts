// Static onboarding data sourced from PRD + 12 Practices framework.

export const LIFE_STAGES = [
  'Student',
  'Early in my career',
  'Emerging leader',
  'Career-builder or in transition',
  'Creator — building my own thing',
  'Founder — running my own',
] as const;

export const YEARS = [
  'Not yet — but I want to grow into it',
  'Less than a year',
  '1–3 years',
  '3–5 years',
  '5–10 years',
  '10+ years',
] as const;

export interface Reason {
  label: string;
  branch: 'challenge' | 'growth' | 'referred' | 'explore';
}

export const REASONS: Reason[] = [
  { label: "I have a specific challenge I'm sitting with", branch: 'challenge' },
  { label: 'I want to grow as a leader over time', branch: 'growth' },
  { label: 'A friend recommended Hogaan', branch: 'referred' },
  { label: 'Just exploring — I want to see how this works', branch: 'explore' },
];

export type PracticeGroup = 'Self' | 'Team' | 'Organization' | 'Community';

export interface Practice {
  group: PracticeGroup;
  name: string;
  gloss: string;
}

export const PRACTICES: Practice[] = [
  { group: 'Self', name: 'Purpose', gloss: 'Explore your values with trusted partners' },
  { group: 'Self', name: 'Integrity', gloss: 'Examine your commitments' },
  { group: 'Self', name: 'Accountability', gloss: 'Be known by the power of your word' },
  { group: 'Team', name: 'Dignity', gloss: 'Prioritize the safety of the team' },
  { group: 'Team', name: 'Empathy', gloss: 'Humanize teams through listening and compassion' },
  { group: 'Team', name: 'Inclusion', gloss: 'Embrace an always-changing, impactful team' },
  { group: 'Organization', name: 'Assets', gloss: 'Build on your diverse set of strengths' },
  {
    group: 'Organization',
    name: 'Innovation',
    gloss: 'Collaborate on concepts that produce tangible solutions',
  },
  { group: 'Organization', name: 'Prosperity', gloss: 'Accelerate growth toward ethical outcomes' },
  { group: 'Community', name: 'Humility', gloss: 'Form courage through embracing your vulnerability' },
  { group: 'Community', name: 'Peace', gloss: 'Promote belonging in response to conflict' },
  { group: 'Community', name: 'Democracy', gloss: 'Practice building power with people' },
];

export const PRACTICE_GROUPS: PracticeGroup[] = ['Self', 'Team', 'Organization', 'Community'];

export interface CommOption {
  id: 'direct' | 'warm';
  title: string;
  body: string;
}

export const COMM: CommOption[] = [
  {
    id: 'direct',
    title: 'Direct and challenging',
    body: 'I want the truth, even when it stings. Get to the point.',
  },
  {
    id: 'warm',
    title: 'Warm and considered',
    body: 'Take your time with me. Help me see the angles.',
  },
];

export interface DepthOption {
  id: 'quick' | 'standard' | 'deep';
  label: string;
  gloss: string;
  rec?: boolean;
}

export const DEPTHS: DepthOption[] = [
  {
    id: 'quick',
    label: 'Quick insight',
    gloss: '50–100 words. A sharp observation and one next move.',
  },
  {
    id: 'standard',
    label: 'Standard coaching',
    gloss: '150–300 words. The full Hamse Arc.',
    rec: true,
  },
  { id: 'deep', label: 'Deep dive', gloss: '300+ words. Full exploration, multiple angles.' },
];

// 12 practices grouped for the auth brand panel and profile view.
export const TWELVE_PRACTICES = [
  { level: 'Self' as const, items: ['Purpose', 'Integrity', 'Accountability'] },
  { level: 'Team' as const, items: ['Dignity', 'Empathy', 'Inclusion'] },
  { level: 'Organization' as const, items: ['Assets', 'Innovation', 'Prosperity'] },
  { level: 'Community' as const, items: ['Humility', 'Peace', 'Democracy'] },
];
