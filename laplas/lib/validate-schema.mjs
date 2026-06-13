// validate-schema.mjs — zero-dep draft-07 SUBSET validator (house pattern:
// the reference is zero-dep node:crypto only; we do not add ajv). Covers exactly
// the keywords our schemas use: type, required, properties, additionalProperties,
// items, enum, minLength, maxLength, minimum, minItems, pattern, not. Anything
// richer belongs in the hounfour ratification, not the kit.
import { readFileSync } from "node:fs";

const typeOf = (v) => Array.isArray(v) ? "array" : v === null ? "null" : typeof v === "number" && Number.isInteger(v) ? "integer" : typeof v;
const typeOk = (v, t) => t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" : typeOf(v) === t;

export function validate(schema, data, path = "") {
  const errs = [];
  const E = (m) => errs.push(`${path || "(root)"}: ${m}`);

  if (schema.type && !typeOk(data, schema.type)) { E(`expected ${schema.type}, got ${typeOf(data)}`); return errs; }
  if (schema.enum && !schema.enum.includes(data)) E(`'${data}' not in enum [${schema.enum.join(", ")}]`);
  if (schema.const !== undefined && data !== schema.const) E(`must equal ${JSON.stringify(schema.const)}`);
  if (typeof data === "string") {
    if (schema.minLength != null && data.length < schema.minLength) E(`shorter than minLength ${schema.minLength}`);
    if (schema.maxLength != null && data.length > schema.maxLength) E(`longer than maxLength ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) E(`does not match /${schema.pattern}/`);
  }
  if (typeof data === "number") {
    if (schema.minimum != null && data < schema.minimum) E(`below minimum ${schema.minimum}`);
    if (schema.maximum != null && data > schema.maximum) E(`above maximum ${schema.maximum}`);
  }
  if (schema.not) { if (validate(schema.not, data, path).length === 0) E(`must NOT match the 'not' schema`); }

  if (Array.isArray(data)) {
    if (schema.minItems != null && data.length < schema.minItems) E(`fewer than minItems ${schema.minItems}`);
    if (schema.items) data.forEach((d, i) => errs.push(...validate(schema.items, d, `${path}[${i}]`)));
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const r of schema.required ?? []) if (!(r in data)) E(`missing required '${r}'`);
    for (const [k, v] of Object.entries(data)) {
      if (schema.properties?.[k]) errs.push(...validate(schema.properties[k], v, path ? `${path}.${k}` : k));
      else if (schema.additionalProperties === false) E(`additional property '${k}' not allowed`);
    }
  }
  return errs;
}

export function validateFile(schemaPath, dataPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  return validate(schema, data);
}
