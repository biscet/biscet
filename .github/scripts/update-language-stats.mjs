import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const repositoryName = process.env.GITHUB_REPOSITORY || 'biscet/biscet';
const branchName = process.env.GITHUB_REF_NAME || 'master';
const tokens = [...new Set((process.env.LANGUAGE_STATS_TOKENS || '').trim().split(/\s+/).filter(Boolean))];

if (tokens.length === 0) {
  throw new Error('Add the LANGUAGE_STATS_TOKENS repository secret before running this workflow.');
}

async function githubGet(token, path) {
  const response = await fetch('https://api.github.com' + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-language-card',
    },
  });
  if (!response.ok) {
    // Never expose repository names, API paths or tokens in public Actions logs.
    throw new Error('GitHub API returned HTTP ' + response.status + '. Check the secret and repository permissions.');
  }
  return response.json();
}

async function listAccessibleRepositories(token) {
  const results = [];
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({
      affiliation: 'owner,collaborator,organization_member',
      per_page: '100',
      page: String(page),
    });
    const batch = await githubGet(token, '/user/repos?' + query);
    if (!Array.isArray(batch)) throw new Error('Unexpected GitHub repositories response.');
    results.push(...batch);
    if (batch.length < 100) return results;
  }
  throw new Error('Repository pagination limit exceeded.');
}

const repositories = new Map();
for (const token of tokens) {
  for (const repository of await listAccessibleRepositories(token)) {
    if (
      repository.fork ||
      repository.archived ||
      repository.disabled ||
      repository.full_name.toLowerCase() === repositoryName.toLowerCase()
    ) continue;
    if (!repositories.has(repository.id)) {
      repositories.set(repository.id, { repository, token });
    }
  }
}
if (repositories.size === 0) {
  throw new Error('No accessible repositories. Check token repository selection and permissions.');
}

const totals = new Map();
const entries = [...repositories.values()];
let repositoriesWithLanguages = 0;
for (let offset = 0; offset < entries.length; offset += 6) {
  await Promise.all(entries.slice(offset, offset + 6).map(async ({ repository, token }) => {
    const repoPath = repository.full_name.split('/').map(encodeURIComponent).join('/');
    const languages = await githubGet(token, '/repos/' + repoPath + '/languages');
    let counted = false;
    for (const [name, bytes] of Object.entries(languages)) {
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      totals.set(name, (totals.get(name) || 0) + bytes);
      counted = true;
    }
    if (counted) repositoriesWithLanguages += 1;
  }));
}
const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
const totalBytes = sorted.reduce((sum, entry) => sum + entry[1], 0);
if (totalBytes === 0) throw new Error('No language data was returned; keeping the existing README card.');

const languageColors = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  HTML: '#e34c26',
  SCSS: '#c6538c',
  CSS: '#563d7c',
  Vue: '#41b883',
  Python: '#3572a5',
  'Jupyter Notebook': '#da5b0b',
  Rust: '#dea584',
  Go: '#00add8',
  Shell: '#89e051',
  Java: '#b07219',
  'C++': '#f34b7d',
  'C#': '#178600',
  PHP: '#4f5d95',
  Ruby: '#701516',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  Dart: '#00b4ab',
};
const fallbackColors = ['#a371f7', '#39c5bb', '#ff8b72', '#79c0ff', '#d2a8ff', '#7ee787'];
function colorFor(name) {
  const hash = [...name].reduce((value, char) => value * 31 + char.codePointAt(0), 0) >>> 0;
  return languageColors[name] || fallbackColors[hash % fallbackColors.length];
}
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
}
const top = sorted.slice(0, 6);
const displayedBytes = top.reduce((sum, entry) => sum + entry[1], 0);

function makeCard(mode) {
  const dark = mode === 'dark';
  const background = dark ? '#0d1117' : '#ffffff';
  const border = dark ? '#30363d' : '#d0d7de';
  const heading = dark ? '#58a6ff' : '#0969da';
  const textColor = dark ? '#c9d1d9' : '#1f2328';
  const pieces = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="450" height="245" viewBox="0 0 450 245" role="img" aria-labelledby="title desc">',
    '<title id="title">Most Used Languages</title>',
    '<desc id="desc">GitHub repository language distribution, including permitted private repositories.</desc>',
    '<rect x="0.5" y="0.5" width="449" height="244" rx="6" fill="' + background + '" stroke="' + border + '"/>',
    '<text x="225" y="50" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="22" fill="' + heading + '">Most Used Languages</text>',
    '<defs><clipPath id="bar-clip"><rect x="40" y="76" width="370" height="10" rx="5"/></clipPath></defs>',
    '<g clip-path="url(#bar-clip)">',
    '<rect x="40" y="76" width="370" height="10" fill="' + border + '"/>',
  ];
  let x = 40;
  for (const [name, bytes] of top) {
    const width = 370 * bytes / totalBytes;
    pieces.push('<rect x="' + x.toFixed(3) + '" y="76" width="' + width.toFixed(3) + '" height="10" fill="' + colorFor(name) + '"/>');
    x += width;
  }
  if (displayedBytes < totalBytes) {
    pieces.push('<rect x="' + x.toFixed(3) + '" y="76" width="' + (410 - x).toFixed(3) + '" height="10" fill="#8b949e"/>');
  }
  pieces.push('</g>');
  for (const [index, [name, bytes]] of top.entries()) {
    const column = index >= 3 ? 1 : 0;
    const row = index % 3;
    const dotX = column === 0 ? 45 : 242;
    const labelX = dotX + 13;
    const y = 125 + 33 * row;
    const shortName = name.length > 16 ? name.slice(0, 15) + '…' : name;
    const label = escapeXml(shortName) + ' ' + (100 * bytes / totalBytes).toFixed(2) + '%';
    pieces.push('<circle cx="' + dotX + '" cy="' + (y - 4) + '" r="6" fill="' + colorFor(name) + '"/>');
    pieces.push('<text x="' + labelX + '" y="' + y + '" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="' + textColor + '"><title>' + escapeXml(name) + '</title>' + label + '</text>');
  }
  pieces.push('</svg>');
  return pieces.join('\n') + '\n';
}

const darkSvg = makeCard('dark');
const lightSvg = makeCard('light');
await mkdir('assets', { recursive: true });
await Promise.all([
  writeFile('assets/languages-dark.svg', darkSvg),
  writeFile('assets/languages-light.svg', lightSvg),
]);

const fingerprint = createHash('sha256').update(darkSvg + lightSvg).digest('hex').slice(0, 12);
const rawBase = 'https://raw.githubusercontent.com/' + repositoryName + '/' + branchName + '/assets/';
const darkUrl = rawBase + 'languages-dark.svg?v=' + fingerprint;
const lightUrl = rawBase + 'languages-light.svg?v=' + fingerprint;
const card = [
  '<!-- PRIVATE_LANGUAGE_STATS:START -->',
  '<picture>',
  '  <source media="(prefers-color-scheme: dark)" srcset="' + darkUrl + '" />',
  '  <source media="(prefers-color-scheme: light)" srcset="' + lightUrl + '" />',
  '  <img align="right" src="' + lightUrl + '" alt="Most used languages, including private repositories" width="360" />',
  '</picture>',
  '<!-- PRIVATE_LANGUAGE_STATS:END -->',
].join('\n');

const originalReadme = await readFile('README.md', 'utf8');
const managedCard = /<!-- PRIVATE_LANGUAGE_STATS:START -->[\s\S]*?<!-- PRIVATE_LANGUAGE_STATS:END -->/;
const originalCard = /<picture>\s*<source[\s\S]*?github-stats-extended\.vercel\.app\/api\/top-langs[\s\S]*?<\/picture>/;
const pattern = managedCard.test(originalReadme) ? managedCard : originalCard;
if (!pattern.test(originalReadme)) {
  throw new Error('Cannot locate the language card in README.md; no README changes were made.');
}
const updatedReadme = originalReadme.replace(pattern, card);
if (updatedReadme !== originalReadme) await writeFile('README.md', updatedReadme);

console.log('Language cards refreshed. Repositories counted: ' + repositoriesWithLanguages + '. Languages found: ' + sorted.length + '.');
