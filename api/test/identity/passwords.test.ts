import { describe, expect, it } from 'vitest';
import { generatePassword, passwordProblem } from '../../src/modules/identity/passwords.js';

describe('password rules (12 characters, a digit, a special character)', () => {
  it('accepts a password that follows them', () => {
    expect(passwordProblem('correct-horse-7')).toBeNull();
    expect(passwordProblem('Lenzi pass 2026')).toBeNull(); // a space is a special character
    expect(passwordProblem('àèìòù-ÀÈÌÒÙ-9')).toBeNull(); // letters of any alphabet
  });

  it('says what is missing', () => {
    expect(passwordProblem('short-1!')).toMatch(/at least 12 characters/);
    expect(passwordProblem('no-digits-here!')).toMatch(/digit/);
    expect(passwordProblem('nospecials2026x')).toMatch(/special character/);
    expect(passwordProblem('x'.repeat(120) + '-1234567890')).toMatch(/at most 128/);
  });

  it('counts characters, not bytes', () => {
    expect(passwordProblem('ééééééééé-1')).toMatch(/at least 12/); // 11 characters
    expect(passwordProblem('éééééééééé-1')).toBeNull(); // 12
  });

  it('a generated password always follows them', () => {
    for (let i = 0; i < 500; i++) {
      const password = generatePassword();
      expect(password).toHaveLength(20);
      expect(passwordProblem(password)).toBeNull();
    }
  });
});
