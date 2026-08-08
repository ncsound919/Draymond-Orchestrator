import { describe, expect, it } from 'vitest';
import {
  parseVerifySteps,
  computeSummary,
  buildSymPyVerificationCode,
  type AnnotatedStep,
} from '@/lib/mathx/verify';

describe('parseVerifySteps', () => {
  it('parses arrow-formatted numbered steps', () => {
    const steps = parseVerifySteps('1. x => x + 1\n2. expand (x+1)^2\n');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      step: 1,
      from_expr: 'x',
      to_expr: 'x + 1',
      verifiable: true,
    });
  });

  it('parses LaTeX arrow forms', () => {
    const steps = parseVerifySteps('step 1: a + b \\to b + a');
    expect(steps).toHaveLength(1);
    expect(steps[0].from_expr).toBe('a + b');
    expect(steps[0].to_expr).toBe('b + a');
  });

  it('infers the operation from prose', () => {
    const [step] = parseVerifySteps('1. expand (x+1)^2 => x^2 + 2x + 1');
    expect(step.operation).toBe('expand');
  });

  it('returns empty for unstructured input', () => {
    expect(parseVerifySteps('no arrows or numbers here')).toEqual([]);
    expect(parseVerifySteps('')).toEqual([]);
  });

  it('caps at maxSteps', () => {
    const content = Array.from({ length: 20 }, (_, i) => `${i + 1}. x => x + ${i}`).join('\n');
    expect(parseVerifySteps(content, 5)).toHaveLength(5);
  });
});

describe('computeSummary', () => {
  const base = {
    description: '',
    from_expr: '',
    to_expr: '',
    operation: 'algebra',
  };

  it('computes trust score = verified / verifiable', () => {
    const steps: AnnotatedStep[] = [
      { ...base, step: 1, verifiable: true, verification: { verified: true, method: 'sympy' } },
      { ...base, step: 2, verifiable: true, verification: { verified: false, method: 'sympy' } },
      { ...base, step: 3, verifiable: false, verification: { verified: null, method: 'skip' } },
    ];
    const s = computeSummary(steps);
    expect(s.total).toBe(3);
    expect(s.verified).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.not_verifiable).toBe(1);
    expect(s.trust_score).toBe(50);
  });

  it('returns 0 trust when nothing is verifiable', () => {
    const steps: AnnotatedStep[] = [
      { ...base, step: 1, verifiable: false, verification: { verified: null, method: 'skip' } },
    ];
    expect(computeSummary(steps).trust_score).toBe(0);
  });
});

describe('buildSymPyVerificationCode', () => {
  it('emits empty results script when nothing is verifiable', () => {
    const code = buildSymPyVerificationCode([
      { step: 1, description: 'def', from_expr: '', to_expr: '', operation: 'algebra', verifiable: false },
    ]);
    expect(code).toContain('"results": []');
    expect(code).not.toContain('sympify');
  });

  it('emits per-step sympy checks', () => {
    const code = buildSymPyVerificationCode([
      {
        step: 1,
        description: 'expand',
        from_expr: '(x + 1)^2',
        to_expr: 'x^2 + 2*x + 1',
        operation: 'expand',
        verifiable: true,
      },
    ]);
    expect(code).toContain('sympify("(x + 1)^2"');
    expect(code).toContain('sympify("x^2 + 2*x + 1"');
    expect(code).toContain('"step": 1');
    expect(code).toContain('"method": "sympy_algebraic"');
  });

  it('escapes double quotes into sympy-safe single quotes', () => {
    const code = buildSymPyVerificationCode([
      {
        step: 1,
        description: 'a',
        from_expr: 'f("x")',
        to_expr: 'x',
        operation: 'algebra',
        verifiable: true,
      },
    ]);
    expect(code).not.toContain('sympify("f("');
    expect(code).toContain("sympify(\"f('x')\"");
  });
});
