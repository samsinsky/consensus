import { describe, expect, it } from 'vitest';
import { ATTACHMENT_LIMITS, checkFile } from '../../src/shared/attachmentRules.js';

describe('checkFile', () => {
  it('accepts supported files within their limit', () => {
    expect(checkFile('brief.docx', 1000)).toBeUndefined();
    expect(checkFile('Shot.PNG', ATTACHMENT_LIMITS.imageBytes)).toBeUndefined();
  });

  it('explains unsupported types', () => {
    expect(checkFile('run.exe', 10)).toBe("Consensus can't read .exe. Attach text, Word, PDF or image files.");
    expect(checkFile('README', 10)).toBe("Consensus can't read files without an extension. Attach text, Word, PDF or image files.");
  });

  it('explains files over the limit for their kind', () => {
    expect(checkFile('big.png', ATTACHMENT_LIMITS.imageBytes + 1)).toBe('big.png is larger than 5MB.');
    expect(checkFile('deck.pdf', ATTACHMENT_LIMITS.fileBytes + 1)).toBe('deck.pdf is larger than 20MB.');
  });
});
