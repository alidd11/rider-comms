// Every native touchable must tell screen readers what it is. A Pressable
// without accessibilityRole is announced as plain text (or not at all), so
// VoiceOver/TalkBack users can't tell it's a button. Backdrops that only
// dismiss a sheet opt out with accessible={false}; components that forward
// props via a spread are checked where they're used.
import { globSync, readFileSync } from 'node:fs';
import ts from 'typescript';

const TOUCHABLES = /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)$/;
const failures = [];
for (const file of globSync('mobile/src/**/*.tsx')) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && TOUCHABLES.test(node.tagName.getText(source))) {
      const props = node.attributes.properties;
      const named = (name) => props.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === name);
      const hiddenFromScreenReaders = named('accessible')?.initializer?.getText(source).includes('false');
      const forwardsProps = props.some(ts.isJsxSpreadAttribute);
      if (!named('accessibilityRole') && !hiddenFromScreenReaders && !forwardsProps) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        failures.push(`${file}:${line + 1}: ${node.tagName.getText(source)} needs accessibilityRole (or accessible={false} for a backdrop)`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Native touchables declare accessibility roles');
