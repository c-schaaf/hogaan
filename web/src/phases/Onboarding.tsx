import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackChevron } from '../components/Primitives';
import { COMM, DEPTHS, LIFE_STAGES, REASONS, YEARS, type CommOption, type DepthOption, type Reason } from './onboarding/data';
import { Screen1Name } from './onboarding/Screen1Name';
import { Screen2Stage } from './onboarding/Screen2Stage';
import { Screen3Years } from './onboarding/Screen3Years';
import { Screen4Reason } from './onboarding/Screen4Reason';
import { Screen5Practices } from './onboarding/Screen5Practices';
import { Screen6Comm } from './onboarding/Screen6Comm';
import { Screen7Depth } from './onboarding/Screen7Depth';
import { ScreenConsent } from './onboarding/ScreenConsent';
import { ScreenDone } from './onboarding/ScreenDone';

const STORAGE_KEY = 'hogaan_onboarding_v1';

// FLOW: 7 questions + consent wrap-up + done celebration.
// Daily-prompts step removed per the Khadija UX reframe deferred edits.
const FLOW = [
  'name',
  'stage',
  'years',
  'reason',
  'practices',
  'comm',
  'depth',
  'consent',
  'done',
] as const;
type Step = (typeof FLOW)[number];

const TOTAL_QUESTIONS = 7; // counter denominator; consent is wrap-up, not a question

export interface OnboardingAnswers {
  name: string;
  stage: string | null;
  years: string | null;
  reason: string | null;
  reasonBranch: Reason['branch'] | null;
  practices: string[];
  comm: CommOption['id'] | null;
  depth: DepthOption['id'];
  consent: boolean;
}

const initialAnswers: OnboardingAnswers = {
  name: '',
  stage: null,
  years: null,
  reason: null,
  reasonBranch: null,
  practices: [],
  comm: null,
  depth: 'standard',
  consent: false,
};

interface PersistedState {
  stepIdx: number;
  answers: OnboardingAnswers;
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function savePersisted(data: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota errors */
  }
}

function clearPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface Props {
  initialName?: string;
  onComplete: (answers: OnboardingAnswers) => void;
}

export function Onboarding({ initialName, onComplete }: Props) {
  const persisted = useMemo(() => loadPersisted(), []);
  const [stepIdx, setStepIdx] = useState(persisted?.stepIdx ?? 0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    ...initialAnswers,
    ...(persisted?.answers ?? {}),
    name: persisted?.answers?.name || initialName || '',
  });
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [animKey, setAnimKey] = useState(0);
  const [confirming, setConfirming] = useState<{ step: Step; index: number } | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (FLOW[stepIdx] === 'done') return;
    savePersisted({ stepIdx, answers });
  }, [stepIdx, answers]);

  const current = FLOW[stepIdx];

  // Progress counter: "Step N of 7" only counts the 7 questions.
  // Consent shows "Almost there" instead of a number.
  const displayStep = current === 'consent' || current === 'done' ? null : stepIdx + 1;
  const progressPct = Math.min(
    100,
    current === 'done' || current === 'consent' ? 100 : (stepIdx / TOTAL_QUESTIONS) * 100,
  );

  const goNext = useCallback(() => {
    setDirection('forward');
    setStepIdx((i) => Math.min(i + 1, FLOW.length - 1));
    setAnimKey((k) => k + 1);
  }, []);

  const goBack = useCallback(() => {
    if (stepIdx === 0) return;
    setDirection('back');
    setStepIdx((i) => Math.max(i - 1, 0));
    setAnimKey((k) => k + 1);
  }, [stepIdx]);

  const autoAdvance = useCallback(
    (index: number, update: Partial<OnboardingAnswers>) => {
      if (current === 'done') return;
      setConfirming({ step: current, index });
      setTimeout(() => {
        setAnswers((prev) => ({ ...prev, ...update }));
        setConfirming(null);
        goNext();
      }, 280);
    },
    [current, goNext],
  );

  const togglePractice = (name: string) => {
    setAnswers((prev) => {
      const has = prev.practices.includes(name);
      return {
        ...prev,
        practices: has ? prev.practices.filter((p) => p !== name) : [...prev.practices, name],
      };
    });
  };

  const startCoaching = useCallback(() => {
    setStarting(true);
    setTimeout(() => {
      setStarting(false);
      clearPersisted();
      goNext();
    }, 900);
  }, [goNext]);

  const openChat = useCallback(() => {
    clearPersisted();
    onComplete({ ...answers });
  }, [answers, onComplete]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'Backspace' && stepIdx > 0) {
        e.preventDefault();
        goBack();
        return;
      }

      if (e.key === 'Enter') {
        if (current === 'practices' && answers.practices.length >= 1) {
          e.preventDefault();
          goNext();
        } else if (current === 'consent' && answers.consent && !starting) {
          e.preventDefault();
          startCoaching();
        } else if (current === 'done') {
          e.preventDefault();
          openChat();
        } else if (current !== 'name') {
          const v = pickValue(current, answers);
          if (v !== null && v !== undefined && v !== '') {
            e.preventDefault();
            goNext();
          }
        }
      }

      const num = Number.parseInt(e.key, 10);
      if (!Number.isNaN(num)) {
        const opts = optionsFor(current);
        if (opts) {
          const idx = num === 0 ? 9 : num - 1;
          if (idx >= 0 && idx < opts.length) {
            e.preventDefault();
            handleNumericPick(current, idx);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function handleNumericPick(step: Step, index: number) {
    switch (step) {
      case 'stage': {
        const v = LIFE_STAGES[index];
        if (v) autoAdvance(index, { stage: v });
        break;
      }
      case 'years': {
        const v = YEARS[index];
        if (v) autoAdvance(index, { years: v });
        break;
      }
      case 'reason': {
        const r = REASONS[index];
        if (r) autoAdvance(index, { reason: r.label, reasonBranch: r.branch });
        break;
      }
      case 'comm': {
        const c = COMM[index];
        if (c) autoAdvance(index, { comm: c.id });
        break;
      }
      case 'depth': {
        const d = DEPTHS[index];
        if (d) autoAdvance(index, { depth: d.id });
        break;
      }
      default:
        break;
    }
  }

  const screen = (() => {
    switch (current) {
      case 'name':
        return (
          <Screen1Name
            value={answers.name}
            onChange={(v) => setAnswers((p) => ({ ...p, name: v }))}
            onContinue={goNext}
          />
        );
      case 'stage':
        return (
          <Screen2Stage
            value={answers.stage}
            onPick={(i, v) => autoAdvance(i, { stage: v })}
            confirming={confirming?.step === 'stage'}
            confirmingIndex={confirming?.index ?? null}
          />
        );
      case 'years':
        return (
          <Screen3Years
            value={answers.years}
            onPick={(i, v) => autoAdvance(i, { years: v })}
            confirming={confirming?.step === 'years'}
            confirmingIndex={confirming?.index ?? null}
          />
        );
      case 'reason':
        return (
          <Screen4Reason
            value={answers.reason}
            onPick={(i, r) => autoAdvance(i, { reason: r.label, reasonBranch: r.branch })}
            confirming={confirming?.step === 'reason'}
            confirmingIndex={confirming?.index ?? null}
          />
        );
      case 'practices':
        return (
          <Screen5Practices values={answers.practices} onToggle={togglePractice} onContinue={goNext} />
        );
      case 'comm':
        return (
          <Screen6Comm
            value={answers.comm}
            onPick={(i, id) => autoAdvance(i, { comm: id })}
            confirming={confirming?.step === 'comm'}
            confirmingIndex={confirming?.index ?? null}
          />
        );
      case 'depth':
        return (
          <Screen7Depth
            value={answers.depth}
            onPick={(i, id) => autoAdvance(i, { depth: id })}
            confirming={confirming?.step === 'depth'}
            confirmingIndex={confirming?.index ?? null}
          />
        );
      case 'consent':
        return (
          <ScreenConsent
            checked={answers.consent}
            onToggle={() => setAnswers((p) => ({ ...p, consent: !p.consent }))}
            onStart={startCoaching}
            starting={starting}
          />
        );
      case 'done':
        return <ScreenDone name={answers.name} onOpen={openChat} />;
    }
  })();

  return (
    <div className="stage">
      <div className="device" data-screen-label={current}>
        <div className="loading-bar" style={{ width: starting ? '100%' : '0%' }} />

        <div className="progress-shell">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          <button
            type="button"
            className="iconbtn"
            onClick={goBack}
            disabled={stepIdx === 0 || current === 'done'}
            aria-label="Back"
          >
            <BackChevron />
          </button>
          <div className="step-counter">
            {current === 'done' ? (
              <span>Complete</span>
            ) : current === 'consent' ? (
              <span style={{ color: 'var(--gold-deep)' }}>Almost there</span>
            ) : (
              <span>
                <strong>{displayStep}</strong>{' '}
                <span style={{ color: 'var(--ink-4)' }}>/ {TOTAL_QUESTIONS}</span>
              </span>
            )}
          </div>
        </div>

        <div className="screen-viewport">
          <div
            key={animKey}
            className={`screen ${direction === 'forward' ? 'slide-forward' : 'slide-back'}`}
          >
            {screen}
          </div>
        </div>
      </div>

      <style>{`
        .slide-forward { animation: slideInRight 320ms var(--ease); }
        .slide-back    { animation: slideInLeft  320ms var(--ease); }
        @keyframes slideInRight {
          from { transform: translateX(20%); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-20%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .slide-forward, .slide-back { animation: none !important; }
          .progress-fill { transition: none !important; }
        }
      `}</style>
    </div>
  );
}

function pickValue(step: Step, a: OnboardingAnswers): unknown {
  switch (step) {
    case 'name':
      return a.name;
    case 'stage':
      return a.stage;
    case 'years':
      return a.years;
    case 'reason':
      return a.reason;
    case 'comm':
      return a.comm;
    case 'depth':
      return a.depth;
    default:
      return null;
  }
}

function optionsFor(step: Step): readonly unknown[] | null {
  switch (step) {
    case 'stage':
      return LIFE_STAGES;
    case 'years':
      return YEARS;
    case 'reason':
      return REASONS;
    case 'comm':
      return COMM;
    case 'depth':
      return DEPTHS;
    default:
      return null;
  }
}
