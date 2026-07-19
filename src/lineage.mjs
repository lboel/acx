// Signed remix lineage shared by workflows and agent graphs.
//
// `lineage` lives inside the artifact document (only `integrity` is removed
// before canonicalization), so every parent claim is covered by the artifact
// signature. Parent coordinates are descriptive links, while `digest` remains
// the immutable content identity.

const ID_RE = /^[a-z][a-z0-9._-]{0,127}$/
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const PUBLISHER_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*(?:[./][a-z0-9][a-z0-9._-]*)*$/

export const LINEAGE_ARTIFACT_TYPES = Object.freeze(['agent', 'workflow', 'agent-graph'])
export const LINEAGE_RELATIONS = Object.freeze(['fork', 'remix', 'derived-from', 'supersedes'])

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, key) {
  return record(value) && Object.prototype.hasOwnProperty.call(value, key)
}

function rejectUnknownKeys(value, allowed, path) {
  if (!record(value)) return [`${path} must be an object`]
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path} contains unknown property '${key}'`)
}

export function validLineageSource(value) {
  if (
    typeof value !== 'string'
    || value.length > 2048
    || value.trim() !== value
    || /\s/.test(value)
  ) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !!url.hostname
      && !url.username
      && !url.password
  } catch {
    return false
  }
}

/**
 * Validate a closed lineage block.
 *
 * `self` is optional for unsigned structural linting. Supplying the signed
 * publisher coordinate additionally prevents an artifact from naming its own
 * registry coordinate as a parent.
 */
export function validateLineage(lineage, { path = 'lineage', self = null } = {}) {
  const issues = rejectUnknownKeys(lineage, ['parents', 'note'], path)
  if (!record(lineage)) return issues

  if (!Array.isArray(lineage.parents) || lineage.parents.length < 1 || lineage.parents.length > 8) {
    issues.push(`${path}.parents must contain 1-8 parent artifacts`)
  }
  if (hasOwn(lineage, 'note') && (
    typeof lineage.note !== 'string'
    || !lineage.note.trim()
    || lineage.note.length > 1000
  )) {
    issues.push(`${path}.note must be a 1-1000 character string`)
  }

  const identities = new Set()
  for (const [index, parent] of (Array.isArray(lineage.parents) ? lineage.parents : []).entries()) {
    const parentPath = `${path}.parents[${index}]`
    issues.push(...rejectUnknownKeys(
      parent,
      ['artifactType', 'publisherId', 'id', 'version', 'digest', 'relation', 'source'],
      parentPath,
    ))
    if (!record(parent)) continue
    if (!LINEAGE_ARTIFACT_TYPES.includes(parent.artifactType)) {
      issues.push(`${parentPath}.artifactType must be agent, workflow, or agent-graph`)
    }
    if (!PUBLISHER_RE.test(parent.publisherId || '')) {
      issues.push(`${parentPath}.publisherId must be a reverse-DNS identifier`)
    }
    if (!ID_RE.test(parent.id || '')) issues.push(`${parentPath}.id is invalid`)
    if (hasOwn(parent, 'version') && !SEMVER_RE.test(parent.version)) {
      issues.push(`${parentPath}.version must be SemVer`)
    }
    if (!DIGEST_RE.test(parent.digest || '')) issues.push(`${parentPath}.digest must be sha256`)
    if (!LINEAGE_RELATIONS.includes(parent.relation)) {
      issues.push(`${parentPath}.relation must be fork, remix, derived-from, or supersedes`)
    }
    if (hasOwn(parent, 'source') && !validLineageSource(parent.source)) {
      issues.push(`${parentPath}.source must be an absolute HTTPS URL without credentials`)
    }

    const identity = [
      parent.artifactType,
      parent.publisherId,
      parent.id,
      parent.version ?? '',
      parent.digest,
    ].join('\u0000')
    if (identities.has(identity)) issues.push(`${parentPath} duplicates another lineage parent`)
    identities.add(identity)

    if (
      self
      && parent.artifactType === self.artifactType
      && parent.publisherId === self.publisherId
      && parent.id === self.id
      && (
        parent.version == null
        || self.version == null
        || parent.version === self.version
      )
    ) {
      issues.push(`${parentPath} collides with the artifact's own registry identity`)
    }
  }
  return [...new Set(issues)]
}
