// Feature flags from GET /api/features (server decides; all default off).
import { useEffect, useState } from 'react';

export interface Features {
  demoMode: boolean;
  leaderBrief: boolean;
  knowledgeDigest: boolean;
  moments: boolean;
  followUpEmail: boolean;
  ratings: boolean;
  weeklyNudge: boolean;
  mcp: boolean;
  billing: boolean;
  orgs: boolean;
  meetingNotes: boolean;
}

export const NO_FEATURES: Features = {
  demoMode: false,
  leaderBrief: false,
  knowledgeDigest: false,
  moments: false,
  followUpEmail: false,
  ratings: false,
  weeklyNudge: false,
  mcp: false,
  billing: false,
  orgs: false,
  meetingNotes: false,
};

let cached: Promise<Features> | null = null;

export function loadFeatures(): Promise<Features> {
  cached ??= fetch('/api/features')
    .then((r) => (r.ok ? (r.json() as Promise<Partial<Features>>) : {}))
    .then((f) => ({ ...NO_FEATURES, ...f }))
    .catch(() => NO_FEATURES);
  return cached;
}

/** Test seam. */
export function resetFeaturesForTests(): void {
  cached = null;
}

export function useFeatures(): Features {
  const [f, setF] = useState<Features>(NO_FEATURES);
  useEffect(() => {
    let live = true;
    void loadFeatures().then((v) => {
      if (live) setF(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return f;
}
