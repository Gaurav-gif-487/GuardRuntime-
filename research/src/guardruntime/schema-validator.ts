/**
 * Pre-Compiled Schema Validator Engine.
 *
 * Implements strict structural argument validation and prototype pollution
 * prevention, protecting against schema drift and malformed payloads.
 */

export type SchemaPropertyType = "string" | "number" | "boolean" | "object" | "array";

export interface PropertyRule {
  type: SchemaPropertyType;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: string[];
}

export interface ToolSchemaDefinition {
  type: "object";
  properties: Record<string, PropertyRule>;
  additionalProperties?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedArgs: Record<string, unknown>;
  errors: string[];
}

export class SchemaValidator {
  private static readonly DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  private static findDangerousKeyPaths(
    value: unknown,
    path = "$",
    seen = new Set<object>(),
  ): string[] {
    if (!value || typeof value !== "object") return [];
    if (seen.has(value as object)) return [`${path} (circular reference)`];
    seen.add(value as object);

    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
      return [`${path} (unexpected prototype)`];
    }

    const found: string[] = [];
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [rawKey, child] of entries) {
      const key = String(rawKey);
      const childPath = `${path}.${key}`;
      if (this.DANGEROUS_KEYS.has(key)) found.push(`Dangerous key detected at "${childPath}"`);
      found.push(...this.findDangerousKeyPaths(child, childPath, seen));
    }
    seen.delete(value as object);
    return found;
  }

  private static clone(value: unknown, seen = new Set<object>()): unknown {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value as object)) throw new Error("circular reference");
    seen.add(value as object);
    if (Array.isArray(value)) {
      const out = value.map((item) => this.clone(item, seen));
      for (const key of Object.keys(value)) {
        if (!/^\d+$/.test(key)) throw new Error(`unexpected array property: ${key}`);
      }
      seen.delete(value as object);
      return out;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error("unexpected prototype");
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (this.DANGEROUS_KEYS.has(key)) throw new Error(`dangerous key: ${key}`);
      out[key] = this.clone(child, seen);
    }
    seen.delete(value as object);
    return out;
  }

  /**
   * Validate and sanitize tool arguments against a structural schema definition.
   */
  static validate(args: Record<string, unknown>, schema?: ToolSchemaDefinition): ValidationResult {
    const errors: string[] = [];
    const sanitized: Record<string, unknown> = {};

    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return {
        valid: false,
        sanitizedArgs: {},
        errors: ["Arguments must be a valid key-value object"],
      };
    }

    // Reject dangerous keys, circular graphs, and non-plain prototypes before
    // producing a detached copy. The runtime never passes caller-owned objects
    // directly to tool implementations.
    for (const path of this.findDangerousKeyPaths(args)) {
      errors.push(path.includes("Dangerous") ? path : `Invalid object at "${path}"`);
    }
    try {
      const cloned = this.clone(args);
      if (cloned && typeof cloned === "object" && !Array.isArray(cloned))
        Object.assign(sanitized, cloned);
    } catch (error) {
      errors.push(
        `Arguments could not be safely normalized: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!schema) {
      return { valid: errors.length === 0, sanitizedArgs: sanitized, errors };
    }

    // Validate properties against schema rules
    for (const [propName, rule] of Object.entries(schema.properties)) {
      const val = sanitized[propName];

      if (rule.required && (val === undefined || val === null)) {
        errors.push(`Missing required field: "${propName}"`);
        continue;
      }

      if (val !== undefined && val !== null) {
        const actualType = typeof val;
        if (rule.type === "number" && (actualType !== "number" || !Number.isFinite(val))) {
          errors.push(`Field "${propName}" must be a finite number`);
        } else if (rule.type === "string" && actualType !== "string") {
          errors.push(`Field "${propName}" must be a string`);
        } else if (rule.type === "boolean" && actualType !== "boolean") {
          errors.push(`Field "${propName}" must be a boolean`);
        }

        // Numeric bounds
        if (rule.type === "number" && typeof val === "number") {
          if (rule.min !== undefined && val < rule.min) {
            errors.push(`Field "${propName}" value ${val} is below minimum ${rule.min}`);
          }
          if (rule.max !== undefined && val > rule.max) {
            errors.push(`Field "${propName}" value ${val} exceeds maximum ${rule.max}`);
          }
        }

        // String patterns & enums
        if (rule.type === "string" && typeof val === "string") {
          if (rule.pattern && !rule.pattern.test(val)) {
            errors.push(`Field "${propName}" does not match required format pattern`);
          }
          if (rule.enum && !rule.enum.includes(val)) {
            errors.push(
              `Field "${propName}" value "${val}" is not in permitted enum: ${rule.enum.join(", ")}`,
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      sanitizedArgs: sanitized,
      errors,
    };
  }
}
