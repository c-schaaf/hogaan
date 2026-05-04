import type { ScenariosPayload } from '../types.js';

/**
 * scenarios v1 — 12 leadership scenarios, one per practice. Per user decision
 * (Phase 2 plan): independent library — all 12 always available, retakes
 * allowed, no prerequisites. Completions logged on user profile but NOT fed
 * back into coaching context.
 *
 * Each scenario is 3–4 turns: coach sets the scene, user responds, coach
 * evaluates and either advances or invites a retry, final reflection.
 *
 * Status: needs Hamse sign-off before Phase A launch (CLAUDE.md hard rule #3).
 */
export const scenariosV1: ScenariosPayload = {
  scenarios: [
    {
      id: 'integrity-the-shortcut',
      title: 'The shortcut',
      practice: 'integrity',
      level: 'self',
      pitch:
        'A vendor offers your team a "courtesy" deal that would speed delivery and quietly bend procurement rules. You\'re the one who has to choose.',
      steps: [
        {
          step: 1,
          coachPrompt:
            'You\'re three weeks behind a board-promised launch. A vendor your team has worked with for years offers you a "favor" — they\'ll start work before the contract is finalized. No paper, no PO yet. Your COO has already nodded yes informally. What do you do, and what do you say to the COO?',
          expectedUserResponseShape: 'A short paragraph naming both the action and the script.',
          evaluationCriteria: [
            'Does the user name the integrity gap explicitly, not euphemistically?',
            'Does the user own their part rather than putting it all on the COO?',
            "Does the script preserve the COO's dignity?",
          ],
        },
        {
          step: 2,
          coachPrompt:
            'The COO pushes back: "You\'re slowing us down for a paperwork issue." Reply.',
          expectedUserResponseShape: 'A 2–3 sentence reply.',
          evaluationCriteria: [
            'Does the user hold the line without moralizing?',
            'Does the reply offer a path forward, not just a blocker?',
          ],
        },
        {
          step: 3,
          coachPrompt:
            'The launch slips two weeks. The board is unhappy. Reflect: what was the cost of integrity here, and what was the return?',
          expectedUserResponseShape: 'Reflection.',
          evaluationCriteria: [
            'Does the user name the cost honestly?',
            'Does the user identify what they built that survives the slip?',
          ],
        },
      ],
      completionCriteria:
        'User completes all three steps with at least step 1 and step 2 meeting their criteria.',
    },
    {
      id: 'purpose-the-reset',
      title: 'The purpose reset',
      practice: 'purpose',
      level: 'self',
      pitch:
        "You've hit your numbers for two years. You're also exhausted, and not sure why you're still doing this work.",
      steps: [
        {
          step: 1,
          coachPrompt:
            'Picture a Tuesday morning where you woke up early without an alarm because the work was pulling you. When was that? What were you doing? Be specific.',
          expectedUserResponseShape: 'A concrete memory — date, situation, who.',
          evaluationCriteria: [
            'Does the user offer a specific memory, not an abstraction?',
            'Does the memory include another person?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            'In your current role, where is that pull most quiet? Which weeks of your calendar would surprise the version of you in that memory?',
          expectedUserResponseShape: 'Direct comparison.',
          evaluationCriteria: [
            'Does the user identify a specific gap?',
            'Is the gap framed as a leadership problem, not a personal failing?',
          ],
        },
        {
          step: 3,
          coachPrompt:
            'What is one thing in your next 14 days that, if you do it, would put you closer to that pull again?',
          expectedUserResponseShape: 'One concrete commitment.',
          evaluationCriteria: [
            'Is the commitment small enough to actually keep?',
            'Does it serve the user, not just the org?',
          ],
        },
      ],
      completionCriteria: 'User completes step 3 with a commitment they can keep this week.',
    },
    {
      id: 'accountability-the-miss',
      title: 'The miss',
      practice: 'accountability',
      level: 'self',
      pitch:
        'Your team missed a major deliverable. Two of your direct reports are blaming each other. You saw it coming three weeks ago.',
      steps: [
        {
          step: 1,
          coachPrompt:
            'Three weeks ago you saw the signal and stayed quiet. What did you see, and what did you tell yourself about why staying quiet was the right call?',
          expectedUserResponseShape: 'Honest reconstruction.',
          evaluationCriteria: [
            'Does the user name the rationalization explicitly?',
            'Does the user separate the data they had from the story they told themselves?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            'In the room with both reports, what is the part you can own — separately from what they need to own?',
          expectedUserResponseShape: 'Specific ownership statement.',
          evaluationCriteria: [
            'Is the ownership concrete, not generic ("I should have communicated better")?',
            'Does the user resist the urge to share blame for absolution?',
          ],
        },
        {
          step: 3,
          coachPrompt: "Write the first three sentences you'll say in the room.",
          expectedUserResponseShape: 'Verbatim opening.',
          evaluationCriteria: [
            "Does the opening own the user's part first, before naming theirs?",
            "Does it preserve the reports' dignity?",
          ],
        },
      ],
      completionCriteria: 'User produces an opening that owns first.',
    },
    {
      id: 'dignity-the-firing',
      title: 'Letting someone go with dignity',
      practice: 'dignity',
      level: 'team',
      pitch:
        'You have to let a long-time team member go. They have helped build the company. You owe them dignity, and you owe the team honesty.',
      steps: [
        {
          step: 1,
          coachPrompt:
            'You have to deliver this news on Tuesday. What do you NOT want this person to feel walking out of that room?',
          expectedUserResponseShape: 'Specific named feelings.',
          evaluationCriteria: [
            'Does the user name dignity-shaped concerns (humiliation, ambush, surprise)?',
            'Does the user resist soft-pedalling the news itself?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            "Naxariis — principled mercy — is what this conversation calls for. Write the first 60 seconds of what you'll say.",
          expectedUserResponseShape: 'Verbatim opening.',
          evaluationCriteria: [
            'Is the news clear in the first 30 seconds, not buried?',
            "Does the user preserve the person's standing without softening the decision?",
          ],
        },
        {
          step: 3,
          coachPrompt:
            "After the meeting, what do you say to the rest of the team — without dishonoring this person's history?",
          expectedUserResponseShape: 'Short team message.',
          evaluationCriteria: [
            'Does the message honor history without re-litigating the decision?',
            'Does it set a tone for how the team handles such transitions?',
          ],
        },
      ],
      completionCriteria: 'User produces a message that holds dignity and clarity together.',
    },
    {
      id: 'empathy-the-monday',
      title: 'The Monday morning',
      practice: 'empathy',
      level: 'team',
      pitch:
        "A direct report is consistently underperforming. You're inclined to manage them out. Before that, sit with what their Monday morning actually looks like.",
      steps: [
        {
          step: 1,
          coachPrompt:
            'Walk through their Monday morning hour by hour, from waking up through 11am. What do you actually know? What are you guessing?',
          expectedUserResponseShape: 'Hour-by-hour reconstruction.',
          evaluationCriteria: [
            'Does the user distinguish data from assumption?',
            'Does the user notice gaps in their knowledge of this person?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            'What is one thing about their context that, if it were true, would change the conversation you should be having?',
          expectedUserResponseShape: 'Specific hypothetical.',
          evaluationCriteria: [
            'Is the hypothetical realistic, not a soft excuse?',
            'Does the user name how it would change the move?',
          ],
        },
        {
          step: 3,
          coachPrompt:
            'What is the question you can ask them this week to find out — without making them defensive?',
          expectedUserResponseShape: 'Verbatim question.',
          evaluationCriteria: [
            'Is the question open and asset-based?',
            'Does it create space for the truth without commanding it?',
          ],
        },
      ],
      completionCriteria: 'User produces a usable question for this week.',
    },
    {
      id: 'inclusion-the-quiet-voice',
      title: 'The quiet voice',
      practice: 'inclusion',
      level: 'team',
      pitch:
        "Your team's decisions are dominated by two loud voices. The third person — quiet, junior, often right — is being talked over.",
      steps: [
        {
          step: 1,
          coachPrompt:
            'In your last three decisions, what did this person actually say, and what did you do with it?',
          expectedUserResponseShape: 'Three concrete recalls.',
          evaluationCriteria: [
            'Does the user remember specific contributions?',
            'Does the user notice if they themselves were among those talking over?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            'What are two structural changes you can make to your meetings this week so their voice gets in front of the loud ones?',
          expectedUserResponseShape: 'Two concrete changes.',
          evaluationCriteria: [
            'Are the changes structural (process), not personality-based?',
            'Will the changes still work when the user is not in the room?',
          ],
        },
        {
          step: 3,
          coachPrompt:
            "How do you tell the loud voices what you're changing, without making it punitive?",
          expectedUserResponseShape: 'Short script.',
          evaluationCriteria: [
            'Does the user honor the loud voices while changing the room?',
            "Does the framing center the team's decisions, not personalities?",
          ],
        },
      ],
      completionCriteria: 'User produces a script that lands change without making enemies.',
    },
    {
      id: 'assets-the-budget-cut',
      title: 'The budget cut',
      practice: 'assets',
      level: 'organization',
      pitch:
        "Your budget was cut 30% mid-quarter. The first instinct is to list what you've lost. Lead instead with what you have.",
      steps: [
        {
          step: 1,
          coachPrompt:
            'List the top five assets your team has that did not change with the budget.',
          expectedUserResponseShape: 'Five concrete assets.',
          evaluationCriteria: [
            'Are the assets specific (named people, named relationships, named knowledge), not generic?',
            'Does the user resist the urge to list what was lost?',
          ],
        },
        {
          step: 2,
          coachPrompt: 'Of those five, which two would surprise an outside observer?',
          expectedUserResponseShape: 'Two assets with brief why.',
          evaluationCriteria: [
            'Does the user identify hidden assets, not the obvious ones?',
            'Is there a clear reason an outsider would underweight them?',
          ],
        },
        {
          step: 3,
          coachPrompt:
            'What is the one move this quarter that uses those two assets in a way the larger budget would have hidden?',
          expectedUserResponseShape: 'One specific move.',
          evaluationCriteria: [
            'Is the move action-shaped, not aspirational?',
            'Does it actually depend on the constraint, not just survive it?',
          ],
        },
      ],
      completionCriteria: 'User identifies a constraint-driven move worth doing.',
    },
    {
      id: 'innovation-the-imported-framework',
      title: 'The imported framework',
      practice: 'innovation',
      level: 'organization',
      pitch:
        'Your CTO wants to install a Silicon Valley engineering practice (sprints, rituals, vocabulary) wholesale into your Mogadishu/Hargeisa team. Some of it will fight your context.',
      steps: [
        {
          step: 1,
          coachPrompt:
            'Pick one ritual from the framework that, in your honest read, will fight your context. Which one, and why?',
          expectedUserResponseShape: 'One ritual + specific clash.',
          evaluationCriteria: [
            'Does the user name a real, specific clash with their context?',
            'Does the user resist the urge to dismiss the whole framework?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            'What does the ritual *actually* try to achieve? What is the underlying need?',
          expectedUserResponseShape: 'The need behind the form.',
          evaluationCriteria: [
            'Does the user separate the form from the need?',
            'Is the need expressed in a way that travels across contexts?',
          ],
        },
        {
          step: 3,
          coachPrompt: 'Design the local version: a ritual that meets that need in your context.',
          expectedUserResponseShape: 'Concrete local ritual.',
          evaluationCriteria: [
            'Does the local version genuinely address the need?',
            "Does it draw on something already in your team's practice?",
          ],
        },
      ],
      completionCriteria: 'User designs a local ritual they could try this month.',
    },
    {
      id: 'prosperity-the-deal',
      title: 'The deal that hurts someone',
      practice: 'prosperity',
      level: 'organization',
      pitch:
        'A deal you can win this quarter would hurt a smaller player you respect. Decide what to do.',
      steps: [
        {
          step: 1,
          coachPrompt: 'Name the smaller player and what they would lose. Be specific.',
          expectedUserResponseShape: 'Named party + specific loss.',
          evaluationCriteria: [
            'Does the user resist abstraction ("the market," "competitors")?',
            'Does the user own their part in the harm?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            'Is there a version of winning this deal that leaves them stronger, not weaker?',
          expectedUserResponseShape: 'A specific structural alternative or "no, and here\'s why."',
          evaluationCriteria: [
            'Does the user actually look for a positive-sum option?',
            "If they conclude there isn't one, do they own that conclusion explicitly?",
          ],
        },
        {
          step: 3,
          coachPrompt:
            "Make the call. Write the two-line note you'd send the smaller player either way.",
          expectedUserResponseShape: 'Two-line note.',
          evaluationCriteria: [
            "Does the note hold the smaller player's dignity?",
            'Does it preserve the future relationship?',
          ],
        },
      ],
      completionCriteria: "User makes a call and writes a note they'd actually send.",
    },
    {
      id: 'humility-the-blind-spot',
      title: 'The blind spot',
      practice: 'humility',
      level: 'community',
      pitch:
        "You're becoming senior. People push back less. Build a structure that forces the truth back in.",
      steps: [
        {
          step: 1,
          coachPrompt:
            'When was the last time someone told you something you genuinely did not want to hear, professionally? Who was it and what did they say?',
          expectedUserResponseShape: 'Concrete recall.',
          evaluationCriteria: [
            'Does the user remember a specific instance?',
            'Does the user honor the messenger?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            "In your current org chart, who is the poet — the truth-teller you cannot fire? If there isn't one, name why.",
          expectedUserResponseShape: 'Named person or honest gap.',
          evaluationCriteria: [
            'Does the user name a real person or face the absence?',
            'Does the user resist the urge to claim a yes-person as a poet?',
          ],
        },
        {
          step: 3,
          coachPrompt:
            "What do you do this quarter to keep that person's seat at the table — or to install a poet if you don't have one?",
          expectedUserResponseShape: 'Concrete commitment.',
          evaluationCriteria: [
            'Is the commitment structural (process / standing meeting), not "I\'ll listen better"?',
          ],
        },
      ],
      completionCriteria: 'User commits to a structural move that protects the poet.',
    },
    {
      id: 'democracy-the-decision',
      title: 'The decision that has to hold',
      practice: 'democracy',
      level: 'community',
      pitch:
        "You're about to make a call your stakeholders are split on. Will the people who lose still defend the process afterward?",
      steps: [
        {
          step: 1,
          coachPrompt:
            'List the three constituencies who care most about this decision and what each one needs to see in the process for them to honor the outcome.',
          expectedUserResponseShape: 'Three constituencies + their process needs.',
          evaluationCriteria: [
            'Does the user think structurally about legitimacy, not just outcome?',
            'Does the user name what each group needs explicitly?',
          ],
        },
        {
          step: 2,
          coachPrompt: 'What part of your current process is opaque on purpose? Be honest.',
          expectedUserResponseShape: 'Specific opacity admitted.',
          evaluationCriteria: [
            'Does the user resist the temptation to pretend the process is fully transparent?',
            'Does the user understand the cost of that opacity?',
          ],
        },
        {
          step: 3,
          coachPrompt:
            'Choose: keep the opacity and name the trade-off, or open it up. Justify the call.',
          expectedUserResponseShape: 'A clear call with reasoning.',
          evaluationCriteria: [
            'Does the user actually choose, not waffle?',
            'Does the reasoning honor the constituencies they listed?',
          ],
        },
      ],
      completionCriteria: 'User makes a defensible call about their process.',
    },
    {
      id: 'peace-the-feud',
      title: 'The feud on autopilot',
      practice: 'peace',
      level: 'community',
      pitch:
        'Two parts of your organization (or two people in your network) are in a feud nobody started but everyone now feeds. You have standing to interrupt it.',
      steps: [
        {
          step: 1,
          coachPrompt: 'Describe the feud in 3 sentences without taking a side.',
          expectedUserResponseShape: 'Neutral description.',
          evaluationCriteria: [
            'Can the user describe it without naming a villain?',
            'Does the description name a real history, not just personalities?',
          ],
        },
        {
          step: 2,
          coachPrompt:
            'What is one gesture you can make — small enough that you can actually do it — that would interrupt the cycle without surrendering the principle?',
          expectedUserResponseShape: 'One gesture.',
          evaluationCriteria: [
            'Is the gesture small enough to be real?',
            'Does it interrupt the cycle without conceding the underlying issue?',
          ],
        },
        {
          step: 3,
          coachPrompt:
            'Who do you tell first — the people in the feud, or the wider community? Justify.',
          expectedUserResponseShape: 'Choice + reasoning.',
          evaluationCriteria: [
            'Does the user think about reception order strategically?',
            'Does the user resist the urge to perform the gesture publicly?',
          ],
        },
      ],
      completionCriteria: 'User commits to a small gesture they will actually make this week.',
    },
  ],

  notes:
    'v1 — independent library per user decision: all 12 always available, retakes allowed, no prerequisites. Completions logged on user profile but NOT fed back into coaching context (Phase 8B.2 confirmed). Needs Hamse sign-off before Phase A launch.',
};
