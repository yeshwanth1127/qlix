/** Shared exclude glob for anything that walks the whole workspace tree
 * (project structure snapshot, final source archive) — generated/vendored
 * directories that would otherwise dominate the scan for no evidentiary value. */
export const SCAN_EXCLUDE_GLOB =
  '**/{node_modules,.git,dist,build,out,.next,__pycache__,.venv,venv,target,.gradle,.idea,coverage}/**';

/** Manifest files whose changes matter more than an ordinary save — tagged on
 * file_snapshot evidence so an evaluator can find dependency changes directly. */
const DEPENDENCY_MANIFEST_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'Gemfile',
  'Gemfile.lock',
]);

export function isDependencyManifest(relativePath: string): boolean {
  const name = relativePath.split(/[\\/]/).pop() ?? relativePath;
  return DEPENDENCY_MANIFEST_NAMES.has(name);
}
