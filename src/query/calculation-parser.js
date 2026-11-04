import { coerceFieldValue } from '../data-types.js';
const isBlank = (value) => value === null || value === undefined;
const arithmetic = (operation) => (a, b) => isBlank(a) || isBlank(b) ? null : operation(Number(a), Number(b));
const comparison = (operation) => (a, b) => isBlank(a) || isBlank(b) ? false : operation(a, b);

const BINARY = Object.freeze({
  OR: (a, b) => Boolean(a) || Boolean(b),
  AND: (a, b) => Boolean(a) && Boolean(b),
  '=': (a, b) => a === b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>': comparison((a, b) => a > b),
  '>=': comparison((a, b) => a >= b),
  '<': comparison((a, b) => a < b),
  '<=': comparison((a, b) => a <= b),
  '+': arithmetic((a, b) => a + b),
  '-': arithmetic((a, b) => a - b),
  '*': arithmetic((a, b) => a * b),
  '/': arithmetic((a, b) => b === 0 ? null : a / b),
  '%': arithmetic((a, b) => b === 0 ? null : a % b),
  '^': arithmetic((a, b) => a ** b),
});

const FUNCTIONS = Object.freeze({
  IF: (condition, yes, no) => condition ? yes : no,
  COALESCE: (...values) => values.find((value) => value !== null && value !== undefined) ?? null,
  ABS: (value) => isBlank(value) ? null : Math.abs(Number(value)),
  ROUND: (value, places = 0) => { if (isBlank(value)) return null; const factor = 10 ** Number(places); return Math.round(Number(value) * factor) / factor; },
  MIN: (...values) => values.some(isBlank) ? null : Math.min(...values.map(Number)),
  MAX: (...values) => values.some(isBlank) ? null : Math.max(...values.map(Number)),
  LOWER: (value) => String(value ?? '').toLocaleLowerCase(),
  UPPER: (value) => String(value ?? '').toLocaleUpperCase(),
  CONCAT: (...values) => values.map((value) => value ?? '').join(''),
  YEAR: (value) => { if (isBlank(value)) return null; const date = new Date(value); return Number.isNaN(date.valueOf()) ? null : date.getUTCFullYear(); },
  MONTH: (value) => { if (isBlank(value)) return null; const date = new Date(value); return Number.isNaN(date.valueOf()) ? null : date.getUTCMonth() + 1; },
});

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '[') {
      const end = source.indexOf(']', index + 1);
      if (end < 0) throw new Error(`Unclosed field reference at position ${index}`);
      tokens.push({ type: 'field', value: source.slice(index + 1, end), position: index });
      index = end + 1;
      continue;
    }
    if (/\d|\./.test(char) && /\d/.test(source[index + (char === '.' ? 1 : 0)] ?? '')) {
      const match = source.slice(index).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i)[0];
      tokens.push({ type: 'literal', value: Number(match), position: index });
      index += match.length;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let end = index + 1;
      let value = '';
      while (end < source.length && source[end] !== quote) {
        if (source[end] === '\\' && end + 1 < source.length) end += 1;
        value += source[end];
        end += 1;
      }
      if (end >= source.length) throw new Error(`Unclosed string at position ${index}`);
      tokens.push({ type: 'literal', value, position: index });
      index = end + 1;
      continue;
    }
    const op = ['>=', '<=', '!=', '=='].find((candidate) => source.startsWith(candidate, index));
    if (op) { tokens.push({ type: 'operator', value: op, position: index }); index += 2; continue; }
    if ('+-*/%^><=(),'.includes(char)) {
      tokens.push({ type: 'operator', value: char, position: index });
      index += 1;
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (identifier) {
      const upper = identifier.toUpperCase();
      tokens.push({ type: ['AND', 'OR', 'NOT'].includes(upper) ? 'operator' : 'identifier', value: upper, position: index });
      index += identifier.length;
      continue;
    }
    throw new Error(`Unexpected token at position ${index}`);
  }
  tokens.push({ type: 'eof', value: '', position: source.length });
  return tokens;
}

export function compileCalculation(source, fields = []) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('A calculated field expression is required.');
  const tokens = tokenize(source);
  const fieldByLabel = new Map(fields.map((field) => [field.label.toLocaleLowerCase(), field]));
  const dependencies = new Set();
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const accept = (value) => peek().value === value ? take() : null;

  function primary() {
    const token = take();
    if (token.type === 'literal') return { type: 'literal', value: token.value };
    if (token.type === 'field') {
      const field = fieldByLabel.get(token.value.toLocaleLowerCase());
      if (!field) throw new Error(`Unknown field “${token.value}” at position ${token.position}`);
      dependencies.add(field.id);
      return { type: 'field', id: field.id };
    }
    if (token.value === '(') {
      const expression = orExpression();
      if (!accept(')')) throw new Error(`Expected ) at position ${peek().position}`);
      return expression;
    }
    if (token.type === 'identifier') {
      const fn = FUNCTIONS[token.value];
      if (!fn || !accept('(')) throw new Error(`Unknown identifier at position ${token.position}`);
      const args = [];
      if (!accept(')')) {
        do { args.push(orExpression()); } while (accept(','));
        if (!accept(')')) throw new Error(`Expected ) at position ${peek().position}`);
      }
      return { type: 'call', name: token.value, args };
    }
    throw new Error(`Unexpected token at position ${token.position}`);
  }
  function unary() {
    const token = peek();
    if (['+', '-', 'NOT'].includes(token.value)) { take(); return { type: 'unary', op: token.value, value: unary() }; }
    return primary();
  }
  function chain(next, operators) {
    let left = next();
    while (operators.includes(peek().value)) { const op = take().value; left = { type: 'binary', op, left, right: next() }; }
    return left;
  }
  const power = () => chain(unary, ['^']);
  const multiply = () => chain(power, ['*', '/', '%']);
  const add = () => chain(multiply, ['+', '-']);
  const compare = () => chain(add, ['=', '==', '!=', '>', '>=', '<', '<=']);
  const andExpression = () => chain(compare, ['AND']);
  const orExpression = () => chain(andExpression, ['OR']);
  const ast = orExpression();
  if (peek().type !== 'eof') throw new Error(`Unexpected token at position ${peek().position}`);

  function evaluateNode(node, row) {
    if (node.type === 'literal') return node.value;
    if (node.type === 'field') return coerceFieldValue(row?.[node.id], fields.find(field => field.id === node.id));
    if (node.type === 'unary') {
      const value = evaluateNode(node.value, row);
      if (node.op === 'NOT') return !value;
      if (isBlank(value)) return null;
      return node.op === '-' ? -Number(value) : Number(value);
    }
    if (node.type === 'binary') return BINARY[node.op](evaluateNode(node.left, row), evaluateNode(node.right, row));
    if (node.type === 'call') return FUNCTIONS[node.name](...node.args.map((arg) => evaluateNode(arg, row)));
    return null;
  }
  return { source, ast, dependencies, evaluate: (row) => evaluateNode(ast, row) };
}
