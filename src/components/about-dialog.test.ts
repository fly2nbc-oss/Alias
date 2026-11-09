/** License notices built into alias.html (repo standard §6.3). */
import { describe, expect, it } from 'vitest';
import thirdParty from '../../THIRD_PARTY.md?raw';
import { mitLicenseText } from './about-dialog';

describe('about: licenses', () => {
  it('takes the MIT block from THIRD_PARTY.md', () => {
    const mit = mitLicenseText(thirdParty);
    expect(mit.startsWith('MIT License')).toBe(true);
    expect(mit).toContain('Arjun Barrett');
    expect(mit).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(mit).not.toContain('```');
  });
});
