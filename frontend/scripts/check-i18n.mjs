import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const locales = ['en', 'es'];
const namespaces = ['common', 'site', 'setup'];
const bundles = {};
for (const locale of locales) {
  bundles[locale] = {};
  for (const namespace of namespaces) {
    const file = new URL(`../src/i18n/locales/${locale}/${namespace}.json`, import.meta.url);
    bundles[locale][namespace] = JSON.parse(await readFile(file, 'utf8'));
  }
}

function describe(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${prefix}:${typeof value}`];
  return Object.entries(value).flatMap(([key, child]) => describe(child, prefix ? `${prefix}.${key}` : key));
}

let failed = false;
for (const namespace of namespaces) {
  const english = describe(bundles.en[namespace]).sort();
  const spanish = describe(bundles.es[namespace]).sort();
  const missingInSpanish = english.filter((entry) => !spanish.includes(entry));
  const extraInSpanish = spanish.filter((entry) => !english.includes(entry));
  if (missingInSpanish.length || extraInSpanish.length) {
    failed = true;
    console.error(`${namespace}: locale bundle shape mismatch.`);
    for (const entry of missingInSpanish) console.error(`Missing from es: ${entry}`);
    for (const entry of extraInSpanish) console.error(`Missing from en: ${entry}`);
  }
}

function normalize(value) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function placeholderShape(value) {
  return value.replace(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g, '{{}}');
}

function expressionCopy(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const alternatives = expressionCopy(span.expression);
      values = values.flatMap((prefix) => alternatives.length
        ? alternatives.map((part) => prefix + part)
        : [prefix + '{{value}}']);
      values = values.map((value) => value + span.literal.text);
    }
    return values;
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return expressionCopy(node.expression);
  }
  if (ts.isConditionalExpression(node)) return [...expressionCopy(node.whenTrue), ...expressionCopy(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return expressionCopy(node.right);
    if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
      return [...expressionCopy(node.left), ...expressionCopy(node.right)];
    }
    if (operator === ts.SyntaxKind.PlusToken) {
      const left = expressionCopy(node.left);
      const right = expressionCopy(node.right);
      if (left.length && right.length) return left.flatMap((a) => right.map((b) => a + b));
      if (left.length) return left.map((a) => a + '{{value}}');
      if (right.length) return right.map((b) => '{{value}}' + b);
    }
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'setupCopy') {
    return node.arguments.flatMap((argument) => expressionCopy(argument));
  }
  return [];
}

async function tsxFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await tsxFiles(fullPath));
    else if (entry.isFile() && fullPath.endsWith('.tsx')) files.push(fullPath);
  }
  return files;
}

const setupCopy = bundles.en.setup.copy;
const coveredCopy = new Set(Object.keys(setupCopy).map((key) => placeholderShape(normalize(key))));
const missingCopy = new Map();
const setupRoot = fileURLToPath(new URL('../src/features/setup/', import.meta.url));
for (const file of await tsxFiles(setupRoot)) {
  const sourceText = await readFile(file, 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function addCopy(value, node) {
    const key = normalize(value);
    if (key.length < 2 || !/[A-Za-z]{2}/.test(key)) return;
    if (coveredCopy.has(placeholderShape(key))) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    const locations = missingCopy.get(key) ?? [];
    locations.push(`${path.relative(path.dirname(new URL(import.meta.url).pathname), file)}:${line + 1}`);
    missingCopy.set(key, locations);
  }

  function walk(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isJsxElement(node) ? node.openingElement : node;
      const attributes = tag.attributes.properties;
      const preserve = attributes.some((attribute) => ts.isJsxAttribute(attribute) && (
        attribute.name.getText(source) === 'data-i18n-preserve'
        || (attribute.name.getText(source) === 'role' && attribute.initializer?.getText(source) === '"alert"')
      ));
      if (preserve) return;

      for (const attribute of attributes) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (!['placeholder', 'title', 'aria-label', 'aria-description', 'alt'].includes(name)) continue;
        if (attribute.initializer && ts.isStringLiteral(attribute.initializer)) addCopy(attribute.initializer.text, attribute.initializer);
        else if (attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
          for (const value of expressionCopy(attribute.initializer.expression)) addCopy(value, attribute.initializer.expression);
        }
      }
      if (ts.isJsxElement(node)) ts.forEachChild(node, walk);
      return;
    }
    if (ts.isJsxText(node)) {
      addCopy(node.getText(source), node);
      return;
    }
    if (ts.isJsxExpression(node) && node.expression && node.parent && !ts.isJsxAttribute(node.parent)) {
      for (const value of expressionCopy(node.expression)) addCopy(value, node.expression);
    }
    ts.forEachChild(node, walk);
  }

  walk(source);
}

if (missingCopy.size) {
  failed = true;
  console.error('Setup UI copy is missing from both locale bundles:');
  for (const [phrase, locations] of [...missingCopy.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`Missing: ${phrase}`);
    for (const location of [...new Set(locations)].slice(0, 3)) console.error(`  ${location}`);
  }
}

for (const locale of locales) {
  const setupCopyForLocale = bundles[locale].setup.copy;
  for (const namespace of ['common', 'site', 'setup']) {
    if (typeof bundles[locale][namespace] !== 'object' || bundles[locale][namespace] === null) {
      failed = true;
      console.error(`${locale}: missing ${namespace} translation resource.`);
    }
  }
  if (!setupCopyForLocale || Object.entries(setupCopyForLocale).some(([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim())) {
    failed = true;
    console.error(`${locale}: setup.copy must contain non-empty string values.`);
  }
}

if (failed) process.exitCode = 1;
