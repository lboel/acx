// Repo-relative paths so the project is self-contained and extractable.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The bundled sample agent-package used by the demos and tests.
 *  Override with ACX_SAMPLE_PACKAGE to point at your own. */
export const SAMPLE_PACKAGE_DIR = process.env.ACX_SAMPLE_PACKAGE
  || join(REPO_ROOT, 'examples', 'sample-agent-package')

export const EXAMPLES_DIR = join(REPO_ROOT, 'examples')
