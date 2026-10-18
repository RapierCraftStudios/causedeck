// Tamil and Kannada wrapping in a real browser (#145): chips, badges, cards and rows wrap long Indic
// strings instead of clipping them, at the 360 px layout and in narrow containers.
import '../../styles/globals.css';

import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  ACTIVITIES,
  ANCHORS,
  INDIC_PROPOSALS,
  NOW,
  PATTERN_INDIC,
  SOURCES,
} from '../__fixtures__/trust';
import { ActivityItem } from '../activity-item/activity-item';
import { LevelBadge } from '../automation-level/level-badge';
import { CourtItemChip } from '../court-item-chip/court-item-chip';
import { MemoryCard } from '../memory-card/memory-card';
import { ObligationRow } from '../obligation-row/obligation-row';
import { ProposalCard } from '../proposal-card/proposal-card';
import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import { ProvenancePopoverBody } from '../provenance-chip/provenance-popover';
import { StageBadge } from '../stage-badge/stage-badge';
import type { ProvenanceSource } from '../types';

const TAMIL = {
  label: 'மெட்ராஸ் உயர் நீதிமன்ற உத்தரவு, பக்கம் 2, காவேரி டெக்ஸ்டைல்ஸ் எதிர் தமிழ்நாடு அரசு',
  stage: 'பட்டியலிடப்பட்டது மற்றும் பகுதி விசாரிக்கப்பட்டது',
  title: 'எதிர் மனுவை நான்கு வாரங்களுக்குள் தாக்கல் செய்ய வேண்டும்',
  matter: 'காவேரி டெக்ஸ்டைல்ஸ் எதிர் தமிழ்நாடு அரசு மற்றும் பிறர்',
  value: 'ஒவ்வொரு விசாரணைக்குப் பிறகும் தமிழில் புதுப்பிப்புகளை விரும்புகிறார்',
};
const KANNADA = {
  label: 'ಕರ್ನಾಟಕ ಉಚ್ಚ ನ್ಯಾಯಾಲಯದ ಆದೇಶ, ಪುಟ 1, ಮಲ್ನಾಡ್ ಕಾಫಿ ಬೆಳೆಗಾರರು ವಿರುದ್ಧ ಅರಣ್ಯ ಇಲಾಖೆ',
  stage: 'ಪಟ್ಟಿ ಮಾಡಲಾಗಿದೆ ಮತ್ತು ಭಾಗಶಃ ವಿಚಾರಣೆಯಾಗಿದೆ',
  title: 'ಕಚೇರಿ ಆಕ್ಷೇಪಣೆಗಳನ್ನು ಎರಡು ವಾರಗಳಲ್ಲಿ ಪಾಲಿಸಬೇಕು',
  matter: 'ಮಲ್ನಾಡ್ ಕಾಫಿ ಬೆಳೆಗಾರರು ವಿರುದ್ಧ ಕರ್ನಾಟಕ ಅರಣ್ಯ ಇಲಾಖೆ',
  value: 'ಊಟದ ನಂತರ ಹೊಸ ಅರ್ಜಿಗಳನ್ನು ಕೇಳುತ್ತದೆ ಮತ್ತು ಸಂಕ್ಷಿಪ್ತ ವಾದಗಳನ್ನು ಬಯಸುತ್ತದೆ',
};

const LOCALES = [
  {
    lang: 'ta',
    text: TAMIL,
    source: SOURCES.tamil,
    anchor: ANCHORS.tamil,
    proposal: INDIC_PROPOSALS.tamil,
    activity: ACTIVITIES.tamil,
    short: PATTERN_INDIC.ta,
  },
  {
    lang: 'kn',
    text: KANNADA,
    source: SOURCES.kannada,
    anchor: ANCHORS.kannada,
    proposal: INDIC_PROPOSALS.kannada,
    activity: ACTIVITIES.kannada,
    short: PATTERN_INDIC.kn,
  },
] as const;

/** Elements whose content is cut off: wider than their box with hidden overflow or an ellipsis. */
function clipped(root: HTMLElement): string[] {
  const problems: string[] = [];
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (el.closest('.sr-only') || el instanceof SVGElement) continue;
    const style = getComputedStyle(el);
    const hides = style.overflowX !== 'visible' || style.textOverflow === 'ellipsis';
    if (el.scrollWidth > el.clientWidth + 1 && hides) {
      problems.push(
        `${el.tagName} "${el.textContent.slice(0, 30)}" ${String(el.scrollWidth)}>${String(el.clientWidth)}`,
      );
    }
    if (style.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 1) {
      problems.push(`${el.tagName} nowrap "${el.textContent.slice(0, 30)}"`);
    }
  }
  return problems;
}

/** Renders `node` in a box of `width` and asserts nothing clips and nothing spills out. */
function expectWraps(node: ReactNode, width: number, lang: string) {
  const { container, unmount } = render(
    <div lang={lang} data-testid="box" style={{ width, overflow: 'visible' }}>
      {node}
    </div>,
  );
  const box = container.querySelector<HTMLElement>('[data-testid="box"]');
  if (!box) throw new Error('no box');
  expect(clipped(box)).toEqual([]);
  // Nothing grows past the box (which would be clipped by any real container).
  for (const el of box.querySelectorAll<HTMLElement>('*')) {
    if (el.closest('.sr-only')) continue;
    const right = el.getBoundingClientRect().right - box.getBoundingClientRect().left;
    expect(right, `${el.tagName} "${el.textContent.slice(0, 30)}"`).toBeLessThanOrEqual(width + 1);
  }
  unmount();
}

describe.each(LOCALES)('$lang strings wrap without clipping', (l) => {
  const longSource: ProvenanceSource = { ...l.source, label: l.text.label };

  it('in the provenance chip and its quote', () => {
    expectWraps(<ProvenanceChip source={longSource} presentation="popover" />, 200, l.lang);
    expectWraps(<ProvenancePopoverBody source={longSource} anchor={l.anchor} />, 200, l.lang);
    const { container } = render(<ProvenancePopoverBody source={l.source} anchor={l.anchor} />);
    const quote = container.querySelector('[data-slot="provenance-quote"]');
    expect(quote && getComputedStyle(quote).overflowWrap).toBe('anywhere');
  });

  it('in level and stage badges', () => {
    expectWraps(<LevelBadge level="L2" labels={{}} />, 80, l.lang);
    expectWraps(<StageBadge stage="listed" label={l.text.stage} />, 140, l.lang);
    expectWraps(<StageBadge stage="filed" label={l.short.filed} />, 360, l.lang);
  });

  it('in the court item chip', () => {
    expectWraps(
      <CourtItemChip
        itemNo={12}
        hall={l.text.matter}
        stage="listed"
        stageLabel={l.text.stage}
        time="10:30"
        source={longSource}
      />,
      360,
      l.lang,
    );
  });

  it('in the proposal card, its diff and chips', () => {
    expectWraps(
      <ProposalCard
        proposal={{
          ...l.proposal,
          title: l.text.title,
          before: l.text.value,
          after: l.text.matter,
          source: longSource,
        }}
        onConfirm={() => undefined}
        onEdit={() => undefined}
        onDismiss={() => undefined}
      />,
      360,
      l.lang,
    );
  });

  it('in the activity item', () => {
    expectWraps(
      <ActivityItem
        {...l.activity}
        sentence={l.text.value}
        source={longSource}
        now={NOW}
        onUndo={() => undefined}
      />,
      360,
      l.lang,
    );
  });

  it('in the obligation row', () => {
    expectWraps(
      <ObligationRow
        id="o"
        title={l.text.title}
        matter={l.text.matter}
        due="2026-10-20"
        owner={{ name: 'Meenakshi Sundaram' }}
        source={longSource}
        now={NOW}
      />,
      360,
      l.lang,
    );
  });

  it('in the memory card', () => {
    expectWraps(
      <MemoryCard
        id="m"
        scope="M6"
        title={l.text.title}
        value={l.text.value}
        source={longSource}
        onEdit={() => undefined}
      />,
      360,
      l.lang,
    );
  });
});
