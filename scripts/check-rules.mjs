// House rules for every tracked or new text file: no emoji, no en or em dash characters, no
// mention of who or what wrote the code, no names of other drawing or collaboration products
// and no comparisons with other products. Words are split here so this file passes itself.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const binary = /\.(png|jpe?g|gif|ico|webp|avif|pdf|ttf|otf|woff2?|wasm|mp3|ogg|webm|mp4|y4m|wav)$/i;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !binary.test(f) && f !== 'package-lock.json' && f !== 'src/wordlist.js' && !f.startsWith('docs/app/core/'));

const w = (...parts) => parts.join('');
const brands = [
  w('excali', 'draw'), w('mi', 'ro'), w('fig', 'ma'), w('fig', 'jam'), w('tl', 'draw'), w('jam', 'board'), w('whim', 'sical'),
  w('lucid', 'chart'), w('can', 'va'), w('dis', 'cord'), w('drop', 'box'), w('air', 'drop'), w('we', 'transfer'),
  w('one', 'note'), w('ever', 'note'), w('tail', 'wind'), w('boot', 'strap'), w('bul', 'ma'), w('ver', 'cel'),
  w('net', 'flix'), w('spo', 'tify'), w('y', 'js'), w('auto', 'merge'), w('pro', 'create'), w('photo', 'shop'),
];
const rules = [
  [new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`), 'an en or em dash'],
  [/\p{Extended_Pictographic}/u, 'an emoji'],
  [new RegExp(`\\b(${w('Clau', 'de')}|${w('Anthro', 'pic')}|${w('Chat', 'GPT')}|${w('Co', 'pilot')}|${w('Open', 'A', 'I')}|${w('Gem', 'ini')})\\b`, 'i'), 'a mention of an assistant'],
  [new RegExp(`\\b${w('A', 'I')}\\b`), 'a mention of generated code'],
  [new RegExp(`\\b(${brands.join('|')})\\b`, 'i'), 'the name of another product'],
  [new RegExp(`\\b(${w('altern', 'ative')}s? to|${w('bet', 'ter')} than|${w('compet', 'itor')}s?|${w('cl', 'one')} of)\\b`, 'i'), 'a comparison with another product'],
];

// The public STUN host names the app connects to and browser executable paths in the test
// tooling are infrastructure, not product mentions.
const allowed = (line) => line.replace(/stun:[^\s'",)]+/g, '').replace(/['"`][A-Za-z]:?[/\\][^'"`]*['"`]/g, '');

const problems = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    const check = allowed(line);
    for (const [re, what] of rules) if (re.test(check)) problems.push(`${file}:${i + 1}: contains ${what}`);
  });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`house rules: ${files.length} files clean`);
