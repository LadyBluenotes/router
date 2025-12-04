import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

interface FrontmatterInfo {
  title?: string;
  skip?: boolean;
  ref?: string;
}

interface NavItem {
  label: string;
  to: string;
  badge?: string;
}

interface FrameworkGroup {
  label: string;
  children: NavItem[];
}

interface Section {
  label: string;
  children: NavItem[];
  frameworks?: FrameworkGroup[];
}

interface DocsConfig {
  docSearch: unknown;
  sections: Section[];
  users?: string[];
}

interface ChangeLog {
  added: string[];
  labelMismatch: Array<{ to: string; existing: string; incoming: string }>;
  removed: string[];
  skipped: string[];
  missingFrontmatter: string[];
  unmatched: string[];
  missingFiles: string[];
}

interface Placement {
  section: Section;
  container: NavItem[];
  framework?: FrameworkGroup;
}

interface PlacementIndex {
  byRoute: Map<string, Placement>;
  byDir: Map<string, Placement>;
}

const DOCS_ROOT = resolve('docs');
const REPO_ROOT = resolve('.');
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*/;
const README_REGEX = /^readme\.mdx?$/i;
const DRAFT_REGEX = /\.draft\.mdx?$/i;
const TITLE_KEYS = new Set(['title']);
const SKIP_KEYS = new Set(['skip']);

const docInfoCache = new Map<string, FrontmatterInfo | null>();

async function readJson<T>(path: string): Promise<T> {
  const raw = await fs.readFile(path, 'utf8');
  return JSON.parse(raw) as T;
}

async function writeJson(path: string, value: unknown) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(path, payload, 'utf8');
}

async function findDocsRoots(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const configPath = join(dir, 'config.json');
    try {
      await fs.access(configPath);
      results.push(dir);
    } catch {
      // ignore directories lacking config.json
    }
  }

  return results;
}

async function listContentFiles(root: string): Promise<string[]> {
  const stack = [root];
  const files: string[] = [];

  while (stack.length) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
        files.push(entryPath);
      }
    }
  }

  files.sort();
  return files;
}

async function readDocInfo(
  filePath: string,
  docsDir: string,
  stack = new Set<string>(),
): Promise<FrontmatterInfo | null> {
  const key = resolve(filePath);
  if (docInfoCache.has(key)) {
    return docInfoCache.get(key)!;
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    docInfoCache.set(key, null);
    return null;
  }

  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) {
    docInfoCache.set(key, null);
    return null;
  }

  const info: FrontmatterInfo = {};
  const block = match[1];

  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) continue;

    const keyPart = trimmed.slice(0, colonIndex).trim();
    let valuePart = trimmed.slice(colonIndex + 1).trim();
    if (!valuePart) continue;

    valuePart = valuePart.split(/\s+#/)[0];

    if (TITLE_KEYS.has(keyPart)) {
      info.title = stripQuotes(valuePart).trim();
    } else if (SKIP_KEYS.has(keyPart)) {
      const normalized = valuePart.toLowerCase();
      info.skip = normalized === 'true' || normalized === 'yes' || normalized === '1';
    } else if (keyPart === 'ref') {
      info.ref = stripQuotes(valuePart);
    }
  }

  if (!info.title && info.ref) {
    const refPath = resolveRefPath(filePath, info.ref, docsDir);
    if (refPath && !stack.has(refPath)) {
      stack.add(refPath);
      const referenced = await readDocInfo(refPath, docsDir, stack);
      stack.delete(refPath);
      if (referenced) {
        if (referenced.title) info.title = referenced.title;
        if (referenced.skip) info.skip = true;
      }
    }
  }

  docInfoCache.set(key, info);
  return info;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveRefPath(sourceFile: string, refValue: string, docsDir: string): string | null {
  const cleanRef = refValue.split(/[\s#]/)[0];
  if (!cleanRef) return null;

  if (cleanRef.startsWith('.')) {
    return resolve(dirname(sourceFile), cleanRef);
  }
  if (cleanRef.startsWith('docs/')) {
    return resolve(REPO_ROOT, cleanRef);
  }
  return resolve(docsDir, cleanRef);
}

function routeFromFile(baseDir: string, filePath: string): string {
  const relPath = relative(baseDir, filePath);
  const withoutExt = relPath.replace(/\.(md|mdx)$/i, '');
  return withoutExt.split(sep).join('/');
}

function parentRoute(route: string): string {
  const idx = route.lastIndexOf('/');
  return idx === -1 ? '' : route.slice(0, idx);
}

function buildPlacementIndex(config: DocsConfig): PlacementIndex {
  const byRoute = new Map<string, Placement>();
  const byDir = new Map<string, Placement>();

  const register = (route: string, placement: Placement) => {
    byRoute.set(route, placement);
    let current: string | undefined = route;
    while (current) {
      if (!byDir.has(current)) {
        byDir.set(current, placement);
      }
      const parent = parentRoute(current);
      if (!parent || parent === current) break;
      current = parent;
    }
  };

  for (const section of config.sections) {
    const sectionPlacement: Placement = { section, container: section.children };
    for (const item of section.children) {
      register(item.to, sectionPlacement);
    }

    if (!section.frameworks) continue;
    for (const framework of section.frameworks) {
      const placement: Placement = { section, container: framework.children, framework };
      for (const item of framework.children) {
        register(item.to, placement);
      }
    }
  }

  return { byRoute, byDir };
}

function findPlacement(route: string, index: PlacementIndex): Placement | undefined {
  let current: string | undefined = route;
  while (current !== undefined) {
    const placement = index.byRoute.get(current) ?? index.byDir.get(current);
    if (placement) return placement;
    const parent = parentRoute(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return undefined;
}

function ensureNavItem(container: NavItem[], item: NavItem, log: ChangeLog) {
  const existing = container.find((entry) => entry.to === item.to);
  if (existing) {
    if (existing.label !== item.label) {
      log.labelMismatch.push({ to: item.to, existing: existing.label, incoming: item.label });
    }
    return;
  }
  container.push(item);
  log.added.push(`${item.label} -> ${item.to}`);
}

function removeSkipped(container: NavItem[], skipped: Set<string>, log: ChangeLog) {
  for (let i = container.length - 1; i >= 0; i -= 1) {
    const entry = container[i];
    if (skipped.has(entry.to)) {
      container.splice(i, 1);
      log.removed.push(entry.to);
    }
  }
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

async function processDocsConfig(dir: string): Promise<ChangeLog> {
  const configPath = join(dir, 'config.json');
  const config = await readJson<DocsConfig>(configPath);
  const index = buildPlacementIndex(config);
  const files = await listContentFiles(dir);

  const log: ChangeLog = {
    added: [],
    labelMismatch: [],
    removed: [],
    skipped: [],
    missingFrontmatter: [],
    unmatched: [],
    missingFiles: [],
  };

  const skipRoutes = new Set<string>();
  const seenRoutes = new Set<string>();

  for (const filePath of files) {
    if (filePath === configPath) continue;
    const fileName = basename(filePath);
    const route = routeFromFile(dir, filePath);
    seenRoutes.add(route);

    if (README_REGEX.test(fileName) || DRAFT_REGEX.test(fileName)) {
      skipRoutes.add(route);
      continue;
    }

    const frontmatter = await readDocInfo(filePath, dir);
    if (!frontmatter || !frontmatter.title) {
      pushUnique(log.missingFrontmatter, relative(dir, filePath));
      continue;
    }

    if (frontmatter.skip) {
      skipRoutes.add(route);
      pushUnique(log.skipped, route);
      continue;
    }

    const placement = findPlacement(route, index);
    if (!placement) {
      pushUnique(log.unmatched, route);
      continue;
    }

    ensureNavItem(placement.container, { label: frontmatter.title.trim(), to: route }, log);
  }

  for (const section of config.sections) {
    removeSkipped(section.children, skipRoutes, log);
    if (section.frameworks) {
      for (const framework of section.frameworks) {
        removeSkipped(framework.children, skipRoutes, log);
      }
    }
  }

  for (const section of config.sections) {
    for (const item of section.children) {
      if (!seenRoutes.has(item.to) && !skipRoutes.has(item.to)) {
        pushUnique(log.missingFiles, item.to);
      }
    }
    if (section.frameworks) {
      for (const framework of section.frameworks) {
        for (const item of framework.children) {
          if (!seenRoutes.has(item.to) && !skipRoutes.has(item.to)) {
            pushUnique(log.missingFiles, item.to);
          }
        }
      }
    }
  }

  await writeJson(configPath, config);
  return log;
}

function printSection(title: string, values: string[]) {
  if (!values.length) return;
  console.log(`  ${title}:`);
  for (const value of values) {
    console.log(`    - ${value}`);
  }
}

async function main() {
  const roots = await findDocsRoots(DOCS_ROOT);
  if (!roots.length) {
    console.log('No docs/config.json folders found.');
    return;
  }

  for (const folder of roots) {
    const rel = relative(DOCS_ROOT, folder) || '.';
    console.log(`\nSyncing ${rel}/config.json`);
    const log = await processDocsConfig(folder);

    printSection('Added entries', log.added);
    printSection('Label/title mismatches (unchanged)', log.labelMismatch.map((item) => `${item.existing} != ${item.incoming} (${item.to})`));
    printSection('Removed (skip:true)', log.removed);
    printSection('Skipped (skip:true) files', log.skipped);
    printSection('Missing frontmatter title', log.missingFrontmatter);
    printSection('Unmatched routes (manual placement required)', log.unmatched);
    printSection('Config entries missing source file', log.missingFiles);

    if (
      !log.added.length &&
      !log.labelMismatch.length &&
      !log.removed.length &&
      !log.skipped.length &&
      !log.missingFrontmatter.length &&
      !log.unmatched.length &&
      !log.missingFiles.length
    ) {
      console.log('  No changes detected.');
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
