import type { CulturalFramingPayload } from '../types.js';

/**
 * cultural_framing v1 — engineering baseline from PRD §7. **Hamse-owned.**
 *
 * 16 Somali concepts. Process #9 §7 selects 1–2 conditionally based on the
 * multi-input DMN over (isDiaspora, responseMode, practiceTag, message content).
 *
 * Discipline: at most one Somali term per response (Voice Rule r7). The
 * `examplePhrasings` are inspiration, NEVER quoted verbatim.
 *
 * Phase 12 R7+R8+R9: practicesMapped populated per the audit-ratified
 * affinity cascade. Xil added (formerly v2-DRAFT, ratified content
 * inlined). The data-driven affinity in src/prompt-assembly/framings.ts
 * (R6) reads these mappings.
 *
 * Affinity cascade (one primary framing per practice):
 *   integrity        → Wadanjirka
 *   purpose          → Soomaalinimo
 *   accountability   → Xil
 *   dignity          → Sharaf
 *   empathy          → Naxariis
 *   inclusion        → Tol
 *   assets           → Refugee resilience
 *   innovation       → Pastoral leadership
 *   prosperity       → Aragti dheer
 *   humility         → Geed daad
 *   democracy        → Hooyo
 *   peace            → Maslaxad
 *
 * Other framings (Xeer, Sahan, Diaspora bridge, Poet as truth-teller) have
 * no primary practice mapping — they remain in the library as additional
 * material the LLM can draw on, but the data-driven selection won't pick
 * them automatically.
 */
export const culturalFramingV1: CulturalFramingPayload = {
  framings: [
    {
      concept: 'Xeer',
      gloss: 'traditional customary law; community deliberation',
      shortDescription:
        'Xeer is the unwritten Somali code that governs how communities deliberate, name stakes, and reach legitimacy. Decisions made under xeer carry weight because the process was visible, not because power compelled them.',
      applicableWhen: [
        'User describes a conflict with no clean authority figure to defer to.',
        'User is choosing whether to make a decision unilaterally or through deliberation.',
        'User mentions governance, retrospectives, or post-mortems.',
      ],
      examplePhrasings: [
        'In Mogadishu boardrooms, xeer says: name the stakes openly before you ask anyone to choose.',
        'What would xeer ask here — whose voice has not yet been heard?',
      ],
    },
    {
      concept: 'Soomaalinimo',
      gloss: 'Somali identity; solidarity across distance',
      shortDescription:
        'The thread that connects Somalis across Mogadishu, Hargeisa, Minneapolis, and Nairobi. A claim on each other that crosses borders and generations.',
      applicableWhen: [
        'User leads a hybrid local + diaspora team.',
        'User asks about belonging, loyalty, or shared identity in a divided team.',
      ],
      examplePhrasings: [
        "Soomaalinimo holds even when the time zones don't — that's a leadership asset, not a coordination tax.",
      ],
      practicesMapped: ['purpose'],
    },
    {
      concept: 'Geed daad',
      gloss: 'the council tree; gathering for decision-making',
      shortDescription:
        'The literal and metaphorical place where elders gathered to deliberate. Decisions made under the geed daad are slow, but they hold.',
      applicableWhen: [
        'User is rushing a decision that needs broad buy-in.',
        'User runs a retrospective, design review, or cross-functional planning meeting.',
      ],
      examplePhrasings: [
        'Before the verdict, the geed daad asks for the question. What is the question your team is actually trying to answer?',
      ],
      practicesMapped: ['humility'],
    },
    {
      concept: 'Pastoral leadership',
      gloss: 'distributed authority from nomadic herding traditions',
      shortDescription:
        'Somali pastoralists ran distributed teams over hundreds of kilometers without daily contact. Authority flowed from clarity of role and trust earned in absence.',
      applicableWhen: [
        'User leads a remote or distributed team.',
        'User struggles with autonomy vs. accountability.',
      ],
      examplePhrasings: [
        "A Somali herder doesn't supervise the herd at midday — they trust the morning instructions and the herd-keeper's judgment. What did your morning instructions actually say?",
      ],
      practicesMapped: ['innovation'],
    },
    {
      concept: 'Tol',
      gloss: 'clan / kinship loyalty',
      shortDescription:
        'The lineage-based loyalty that has both held Somali society together and torn it apart. Mature leaders learn to honor it without being captured by it.',
      applicableWhen: [
        'User navigates a hiring or promotion decision with kinship pressure.',
        'User mentors someone from a connected community.',
      ],
      examplePhrasings: [
        'Tol pulls you to give the role to your cousin. Leadership asks: would the role come to your cousin without the pull?',
      ],
      practicesMapped: ['inclusion'],
    },
    {
      concept: 'Sahan',
      gloss: 'hospitality; generous welcome',
      shortDescription:
        'The Somali code that says a guest must be fed before being asked their business. In organizational terms: trust is built before transactions.',
      applicableWhen: [
        'User onboards a new hire, partner, or board member.',
        'User builds trust with a counterpart in a negotiation.',
      ],
      examplePhrasings: [
        'Sahan would feed them first. What is the equivalent in your Monday onboarding meeting?',
      ],
    },
    {
      concept: 'Aragti dheer',
      gloss: 'long view; multi-generational planning',
      shortDescription:
        'Literally "long sight." The discipline of choosing the move that looks foolish this quarter and obvious in five years.',
      applicableWhen: [
        'User chooses between short-term win and long-term capability.',
        'User considers legacy, succession, or institution-building.',
      ],
      examplePhrasings: [
        'Aragti dheer asks: what will this decision have built in five years, even if it costs you something now?',
      ],
      practicesMapped: ['prosperity'],
    },
    {
      concept: 'Refugee resilience',
      gloss: 'the discipline of starting over from nothing',
      shortDescription:
        'The lived knowledge of Somalis who rebuilt twice — the first time across the border, the second time in their professional lives in a new country.',
      applicableWhen: [
        'User faces a setback, layoff, failed venture, or forced rebuild.',
        'User questions whether to keep going.',
      ],
      examplePhrasings: [
        "You already know how to start over — your family showed you. The question is what you're building this time.",
      ],
      practicesMapped: ['assets'],
    },
    {
      concept: 'Diaspora bridge',
      gloss: 'code-switching between worlds',
      shortDescription:
        'The skill of holding multiple cultural codes at once — moving between Mogadishu and Minneapolis without losing yourself in either.',
      applicableWhen: [
        'User navigates between local and Western expectations.',
        'User leads across cultures or returns home after time abroad.',
      ],
      examplePhrasings: [
        "You're the bridge — and bridges carry weight from both sides. The skill is staying anchored, not picking one side.",
      ],
    },
    {
      concept: 'Naxariis',
      gloss: 'compassion; principled mercy',
      shortDescription:
        'Not soft compassion — the kind of mercy that holds someone accountable while preserving their dignity. Naxariis is what a leader brings to a hard conversation.',
      applicableWhen: [
        'User needs to deliver hard feedback or end an arrangement.',
        'User is thinking about how to be kind without being weak.',
      ],
      examplePhrasings: [
        "Naxariis is not avoidance. It's telling the truth in a way that lets the other person stand up afterward.",
      ],
      practicesMapped: ['empathy'],
    },
    {
      concept: 'Sharaf',
      gloss: "honor; one's standing in the eyes of one's people",
      shortDescription:
        "Sharaf is the leader's most fragile asset. It is built slowly, lost quickly, and carried by reputation across rooms you have never been in.",
      applicableWhen: [
        'User is in a high-visibility decision.',
        'User is considering a shortcut that would compromise reputation.',
        'User is repairing a damaged relationship.',
      ],
      examplePhrasings: [
        'Sharaf is at stake here, not just the deal. Which version of you walks out of this meeting?',
      ],
      practicesMapped: ['dignity'],
    },
    {
      concept: 'Wadanjirka',
      gloss: 'citizenship; civic responsibility',
      shortDescription:
        'The duty owed to the polity — to country, city, profession. Wadanjirka is the answer to "why am I doing this work?"',
      applicableWhen: [
        'User questions purpose mid-career.',
        'User leads in public service, regulated industry, or institutional roles.',
      ],
      examplePhrasings: [
        'Wadanjirka is the reset question: who is this work in service of, beyond the org chart?',
      ],
      practicesMapped: ['integrity'],
    },
    {
      concept: 'Poet as truth-teller',
      gloss: 'tradition of poets holding leaders accountable',
      shortDescription:
        'In Somali tradition, the poet (gabayaa) was the conscience of power — the one who could speak truth to the chief without being silenced. Leaders need poets in their lives.',
      applicableWhen: [
        'User is becoming senior and noticing fewer people push back.',
        'User must speak hard truth upward.',
      ],
      examplePhrasings: [
        "Who is the poet in your room — the person who tells you the truth even when the room doesn't want it?",
      ],
    },
    {
      concept: 'Maslaxad',
      gloss: 'compromise; deliberate middle ground',
      shortDescription:
        'Not weak compromise — the deliberate construction of a middle that both sides can stand on. Maslaxad is craft, not capitulation.',
      applicableWhen: [
        'User is in a negotiation where both extremes are bad.',
        'User mediates between people who each see only their side.',
      ],
      examplePhrasings: [
        "Maslaxad isn't splitting the difference. It's building a third option that the first two can both live with.",
      ],
      practicesMapped: ['peace'],
    },
    {
      concept: 'Hooyo',
      gloss: 'the legitimacy of voice — the one who hears all children equally',
      shortDescription:
        'Hooyo (mother) is the first leader anyone meets — and the impartial listener of the household. In Somali leadership tradition the mother arbitrates by hearing every child fully before deciding; her authority comes from being known to be fair, not from being loud. The democratic ear, before there is a council.',
      applicableWhen: [
        'User is making a decision that affects multiple parties with competing claims.',
        'User is running a process where every voice needs to be heard.',
        'User is leading through a crisis where the team needs steadiness.',
        'User undervalues their own care-based leadership style.',
      ],
      examplePhrasings: [
        'Hooyo led without an org chart — through presence, food, and the steady voice. What does that look like in your team this week?',
        'Hooyo hears every child before she speaks. Whose voice in your team has not yet been fully heard?',
      ],
      practicesMapped: ['democracy'],
    },
    {
      concept: 'Xil',
      gloss: 'duty/obligation that comes with role',
      shortDescription:
        'Xil is the weight a role places on you — not honor (Sharaf), not citizenship (Wadanjirka), but the specific debt incurred by accepting authority. A leader who carries Xil knows that the role asked something of them before they asked anything of it.',
      applicableWhen: [
        'User accepted a promotion or new responsibility and is feeling the weight of it.',
        'User is debating whether to step away from a hard call that is rightfully theirs.',
        'User is delegating something they should be doing personally.',
        'User is conflating popularity with discharging their role.',
      ],
      examplePhrasings: [
        'Xil asks the quiet question: what did the role ask of you that you have not yet given?',
        'Sharaf is what others give you. Xil is what the role takes from you. They are not the same thing.',
        "When you accepted the title, you also accepted xil. The weight you feel now is not weakness — it's the role doing what roles do.",
      ],
      practicesMapped: ['accountability'],
    },
  ],
};
