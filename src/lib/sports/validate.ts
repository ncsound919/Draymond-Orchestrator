export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateOutput(output: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!output || typeof output !== 'object') {
    errors.push('output is not an object');
    return { valid: false, errors, warnings };
  }
  const o = output as Record<string, unknown>;
  const rows = o.data ?? o.rows;
  if (rows === undefined) {
    errors.push('missing data field');
  } else if (!Array.isArray(rows)) {
    errors.push('data field must be an array');
  } else {
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        errors.push('data row must be an object');
        continue;
      }
      for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))) {
          errors.push(`invalid value in field ${key}`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}
