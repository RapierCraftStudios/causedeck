import { describe, expect, it } from 'vitest';

import { detectDocumentLanguage, detectLanguage } from './detect.ts';

describe('detectLanguage', () => {
  it('tags English, Tamil and Kannada from script ratios', () => {
    expect(detectLanguage('The respondent shall file a counter on the next date.')).toBe('en');
    expect(detectLanguage('எதிர்மனுதாரர் பதில் மனுவை தாக்கல் செய்ய வேண்டும்')).toBe('ta');
    expect(detectLanguage('ಪ್ರತಿವಾದಿಯು ಉತ್ತರ ಸಲ್ಲಿಸಬೇಕು')).toBe('kn');
  });

  it('tags a Kannada order with English case numbers kn+en', () => {
    const text =
      'ಕಾವೇರಿ ಮಾದರಿ ಅವರ ಅರ್ಜಿಯ ವಿಚಾರಣೆ ನಡೆಯಿತು. Case Nos. W.P. 1042/2024 and C.P. 77/2025';
    expect(detectLanguage(text)).toBe('kn+en');
  });

  it('tags Tamil with English admixture ta+en', () => {
    expect(detectLanguage('வழக்கு எண் Writ Petition 12/2024 விசாரணைக்கு வந்தது')).toBe('ta+en');
  });

  it('does not read ASCII digits or Tamil/Kannada digits as English', () => {
    expect(detectLanguage('ಅರ್ಜಿ ೧೨೩೪ ೨೦೨೪ ಸಲ್ಲಿಸಲಾಗಿದೆ 1234/2024')).toBe('kn');
    expect(detectLanguage('௧௨௩ ௨௦௨௪')).toBeNull();
  });

  it('tags a whole document from the summed pages', () => {
    expect(
      detectDocumentLanguage(['The order of the court.', 'ಆದೇಶ ನ್ಯಾಯಾಲಯ ವಿಚಾರಣೆ ನಡೆಯಿತು ಅರ್ಜಿ']),
    ).toBe('kn+en');
    expect(detectDocumentLanguage(['', '12'])).toBeNull();
  });
});
