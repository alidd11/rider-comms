import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const SRC = new URL('../src/', import.meta.url).pathname;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** Each `<Pressable ...>` opening tag with its body (up to the closing tag). */
function pressables(source: string): Array<{ line: number; opening: string; body: string }> {
  const found: Array<{ line: number; opening: string; body: string }> = [];
  for (const match of source.matchAll(/<Pressable\b/g)) {
    let i = match.index + match[0].length;
    let depth = 0;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    const opening = source.slice(match.index, i + 1);
    const close = opening.endsWith('/>') ? i : source.indexOf('</Pressable>', i);
    found.push({ line: source.slice(0, match.index).split('\n').length, opening, body: source.slice(i + 1, close) });
  }
  return found;
}

test('every Pressable tells screen readers what it is', () => {
  const problems: string[] = [];
  for (const file of tsxFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const { line, opening, body } of pressables(source)) {
      const where = `${relative(SRC, file)}:${line}`;
      // Backdrops and sheet containers opt out so VoiceOver reaches their contents.
      if (opening.includes('accessible={false}')) continue;
      if (!opening.includes('accessibilityRole')) problems.push(`${where} has no accessibilityRole`);
      // Without visible text, the control's name has to come from a label.
      if (!/<Text\b|\{bubble\}/.test(body) && !opening.includes('accessibilityLabel')) problems.push(`${where} is icon-only with no accessibilityLabel`);
    }
  }
  assert.deepEqual(problems, []);
});
