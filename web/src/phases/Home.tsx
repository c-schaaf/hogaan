import { useMemo, useState } from 'react';
import { HogaanWordmark } from '../components/HogaanWordmark';
import { HomeIconMic, HomeIconSpark } from '../components/Icons';
import { BottomNav, DesktopSidebar, type Tab } from '../components/Nav';

interface Suggestion {
  topic: string;
  practice: string;
}

const PRACTICE_SUGGESTIONS: Record<string, Suggestion> = {
  Empathy: { topic: 'A difficult conversation with a team member', practice: 'Empathy' },
  Integrity: { topic: "A commitment I'm struggling to keep", practice: 'Integrity' },
  Purpose: { topic: 'Why I took on this role', practice: 'Purpose' },
  Accountability: { topic: 'A promise I broke and want to repair', practice: 'Accountability' },
  Dignity: { topic: "Someone on my team I'm not treating fairly", practice: 'Dignity' },
  Peace: { topic: 'A tension I keep walking around', practice: 'Peace' },
  Humility: { topic: "A moment I wish I'd handled differently", practice: 'Humility' },
  Inclusion: {
    topic: "Who's at the edges of my team I should pull in",
    practice: 'Inclusion',
  },
  Assets: { topic: 'What strengths am I under-using', practice: 'Assets' },
  Innovation: { topic: 'An idea I keep dismissing', practice: 'Innovation' },
  Prosperity: { topic: 'A growth decision under pressure', practice: 'Prosperity' },
  Democracy: { topic: 'Whose voice am I not hearing', practice: 'Democracy' },
};

const FALLBACK: Suggestion[] = [
  { topic: 'A difficult conversation tomorrow', practice: 'Empathy' },
  { topic: 'A team member underperforming', practice: 'Accountability' },
  { topic: 'Disagreeing with my boss', practice: 'Integrity' },
];

function greetingFor(name: string, hour: number): string {
  if (hour >= 23 || hour < 5) return `Still up, ${name}?`;
  if (hour < 12) return `Good morning, ${name}.`;
  if (hour < 17) return `Good afternoon, ${name}.`;
  return `Good evening, ${name}.`;
}

function suggestionsFor(practices: string[] | undefined): Suggestion[] {
  if (!practices || practices.length === 0) return FALLBACK;
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const p of practices) {
    if (out.length >= 3) break;
    const hit = PRACTICE_SUGGESTIONS[p];
    if (hit && !seen.has(p)) {
      out.push(hit);
      seen.add(p);
    }
  }
  for (const f of FALLBACK) {
    if (out.length >= 3) break;
    if (!seen.has(f.practice)) {
      out.push(f);
      seen.add(f.practice);
    }
  }
  return out.slice(0, 3);
}

interface Props {
  user: { name: string };
  practices?: string[];
  showPracticeCaption?: boolean;
  onCompose: (seed: string | null) => void;
  onNav: (t: Tab) => void;
}

export function Home({ user, practices, showPracticeCaption = false, onCompose, onNav }: Props) {
  const name = user.name || 'friend';
  const hour = new Date().getHours();
  const greeting = useMemo(() => greetingFor(name, hour), [name, hour]);
  const [composeText, setComposeText] = useState('');
  const suggestions = useMemo(() => suggestionsFor(practices), [practices]);

  return (
    <div className="hm-page">
      <DesktopSidebar active="home" onNav={onNav} />

      <main className="hm-shell">
        <div className="hm-topbar">
          <HogaanWordmark small />
        </div>

        <div className="hm-scroll">
          <div className="hm-inner">
            <h1 className="hm-greet">{greeting}</h1>
            <p className="hm-sub">What's on your mind?</p>

            <button
              type="button"
              className="hm-compose"
              onClick={() => onCompose(composeText || null)}
              aria-label="Open chat"
            >
              <span className="hm-mic">
                <HomeIconMic />
              </span>
              <input
                className="hm-compose-input"
                placeholder="Tell me what happened today…"
                value={composeText}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setComposeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.altKey && !e.metaKey) onCompose(composeText || null);
                }}
              />
              <span className="hm-compose-arrow">→</span>
            </button>

            <div className="hm-section-h">You might want to explore</div>
            <div className="hm-chips">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="hm-chip"
                  onClick={() => onCompose(s.topic)}
                >
                  <span className="hm-chip-ico">
                    <HomeIconSpark />
                  </span>
                  <span className="hm-chip-body">
                    <span className="hm-chip-label">{s.topic}</span>
                    {showPracticeCaption && (
                      <span className="hm-chip-tied">
                        Tied to your practice · <strong>{s.practice}</strong>
                      </span>
                    )}
                  </span>
                  <span className="hm-chip-arrow">→</span>
                </button>
              ))}
            </div>

            <div className="hm-foot-space" />
          </div>
        </div>

        <BottomNav active="home" onNav={onNav} />
      </main>
    </div>
  );
}
