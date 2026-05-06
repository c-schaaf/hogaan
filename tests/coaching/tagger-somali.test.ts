import { describe, expect, it } from 'vitest';
import { tagPracticeAndLevel } from '../../src/coaching/tagger.js';
import type { PracticeTag } from '../../src/shared/types/index.js';

/**
 * Phase 12 R12 — Somali keyword coverage.
 *
 * 5 phrases per practice (60 total) where the message is in Somali OR
 * mixes English and Somali. The tagger must identify the practice when
 * the Somali keyword fires.
 *
 * These are deliberately conservative — common, well-attested terms.
 * Tighter calibration is a Phase 2 native-speaker review item.
 */

const SAMPLES: ReadonlyArray<{ text: string; expected: PracticeTag }> = [
  // integrity (sharafteyda/qiimayaal/mabaadi)
  { text: 'sharafteyda waxay ila tahay muhiim', expected: 'integrity' },
  { text: 'qiimayaal qof ahaan', expected: 'integrity' },
  { text: 'mabaadi-da hadafkii', expected: 'integrity' },
  { text: 'sharafteyda iyo principles-keyga', expected: 'integrity' },
  { text: 'qiimayaal aan ku jeebahayo', expected: 'integrity' },

  // purpose (ujeedo/macno/sababta)
  { text: 'ujeedo of this work', expected: 'purpose' },
  { text: "macno la'aan", expected: 'purpose' },
  { text: 'sababta uu shaqadaan u jiro', expected: 'purpose' },
  { text: 'ujeedo iyo macno', expected: 'purpose' },
  { text: 'sababta uu shaqada uu sii joogo', expected: 'purpose' },

  // accountability (xil/mas'uuliyad)
  { text: 'xil weyn ayaa i saaran', expected: 'accountability' },
  { text: "mas'uuliyad iigu yaal", expected: 'accountability' },
  { text: 'masuuliyad ii saaran tahay', expected: 'accountability' },
  { text: "ii saaran tahay go'aankan", expected: 'accountability' },
  { text: "xil iyo go'aamada", expected: 'accountability' },

  // dignity (sharaf/ixtiraam/fool)
  { text: 'sharaf-da ayaa la qaaday', expected: 'dignity' },
  { text: "ixtiraam la'aan ayaa muujiyay", expected: 'dignity' },
  { text: 'fool-keyga waxaa la jaray', expected: 'dignity' },
  { text: 'sharaf iyo ixtiraam', expected: 'dignity' },
  { text: 'ixtiraam shaqaalaha', expected: 'dignity' },

  // empathy (naxariis/fahmis/dareen)
  { text: 'naxariis u baahan tahay', expected: 'empathy' },
  { text: 'dareen-keyga waxaan u sheegay', expected: 'empathy' },
  { text: 'fahmis qoto dheer', expected: 'empathy' },
  { text: 'naxariis iyo dareen-fahmis', expected: 'empathy' },
  { text: 'dareen iyo fahmis dadka kale', expected: 'empathy' },
];

describe('Phase 12 R12 — tagger picks practice from Somali keywords', () => {
  for (const { text, expected } of SAMPLES) {
    it(`"${text}" → ${expected}`, () => {
      const r = tagPracticeAndLevel(text);
      expect(r.practiceTag).toBe(expected);
    });
  }
});

describe('Phase 12 R12 — tagger picks level from Somali keywords', () => {
  it('aniga → self', () => {
    expect(tagPracticeAndLevel('aniga ayaan dareemaya integrity').levelTag).toBe('self');
  });
  it('kooxda → team', () => {
    expect(tagPracticeAndLevel('kooxda ayaa la kulmay nabad').levelTag).toBe('team');
  });
  it('shirkadda → organization', () => {
    expect(tagPracticeAndLevel('shirkadda waxay rabtaa hal-abuur').levelTag).toBe('organization');
  });
  it('bulshada → community', () => {
    expect(tagPracticeAndLevel('bulshada Soomaaliyeed waxay rabtaa nabad').levelTag).toBe(
      'community',
    );
  });
});
