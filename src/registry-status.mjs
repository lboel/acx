// Git-reviewed lifecycle/advisory status for immutable registry artifacts.
// The ledger never mutates an artifact or changes its cryptographic trust.

import { readFileSync } from 'node:fs'

export const REGISTRY_STATUS_SCHEMA_VERSION = 'acx.registry-status/1'

const ID_RE = /^[a-z][a-z0-9._-]{0,127}$/
const AGENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const PUBLISHER_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*(?:[./][a-z0-9][a-z0-9._-]*)*$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const ARTIFACT_TYPES = new Set(['agent', 'workflow', 'agent-graph'])
const STATUSES = new Set(['deprecated', 'withdrawn', 'superseded'])

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, allowed, path) {
  if (!record(value)) return [`${path} must be an object`]
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path} contains unknown property '${key}'`)
}

function validDate(value) {
  return typeof value === 'string' && RFC3339_RE.test(value) && !Number.isNaN(Date.parse(value))
}

function validUri(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function validateIdentity(identity, path) {
  const issues = exactKeys(identity, ['artifactType', 'publisherId', 'id', 'version', 'digest'], path)
  if (!record(identity)) return issues
  if (!ARTIFACT_TYPES.has(identity.artifactType)) issues.push(`${path}.artifactType is invalid`)
  if (!PUBLISHER_RE.test(identity.publisherId || '')) issues.push(`${path}.publisherId is invalid`)
  if (!ID_RE.test(identity.id || '')) issues.push(`${path}.id is invalid`)
  if (identity.artifactType === 'agent' && !AGENT_ID_RE.test(identity.id || '')) {
    issues.push(`${path}.id must be a lowercase agent registry slug`)
  }
  if (!SEMVER_RE.test(identity.version || '')) issues.push(`${path}.version is required and must be SemVer`)
  if (!DIGEST_RE.test(identity.digest || '')) issues.push(`${path}.digest must be sha256`)
  return issues
}

export function statusIdentityKey(identity) {
  return [
    identity?.artifactType || '',
    identity?.publisherId || '',
    identity?.id || '',
    identity?.version || '',
    identity?.digest || '',
  ].join('\u0000')
}

export function validateRegistryStatus(document) {
  const issues = exactKeys(document, ['schemaVersion', 'updatedAt', 'entries'], 'registry status')
  if (!record(document)) return issues
  if (document.schemaVersion !== REGISTRY_STATUS_SCHEMA_VERSION) {
    issues.push(`registry status schemaVersion must be ${REGISTRY_STATUS_SCHEMA_VERSION}`)
  }
  if (!validDate(document.updatedAt)) issues.push('registry status.updatedAt must be RFC 3339')
  if (!Array.isArray(document.entries)) {
    issues.push('registry status.entries must be an array')
    return issues
  }

  const seen = new Set()
  document.entries.forEach((entry, index) => {
    const path = `registry status.entries[${index}]`
    issues.push(...exactKeys(entry, ['artifact', 'status', 'reason', 'recordedAt', 'successor', 'advisory'], path))
    if (!record(entry)) return
    issues.push(...validateIdentity(entry.artifact, `${path}.artifact`))
    if (!STATUSES.has(entry.status)) issues.push(`${path}.status is invalid`)
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10 || entry.reason.length > 1000) {
      issues.push(`${path}.reason must be a 10-1000 character string`)
    }
    if (!validDate(entry.recordedAt)) issues.push(`${path}.recordedAt must be RFC 3339`)
    if (entry.successor != null) {
      issues.push(...validateIdentity(entry.successor, `${path}.successor`))
      if (record(entry.artifact) && record(entry.successor)) {
        if (entry.successor.artifactType !== entry.artifact.artifactType) {
          issues.push(`${path}.successor.artifactType must match the superseded artifact type`)
        }
        if (statusIdentityKey(entry.successor) === statusIdentityKey(entry.artifact)) {
          issues.push(`${path}.successor must differ from the status target`)
        }
        const targetCoordinate = [
          entry.artifact.publisherId,
          entry.artifact.id,
          entry.artifact.version,
        ].join('\u0000')
        const successorCoordinate = [
          entry.successor.publisherId,
          entry.successor.id,
          entry.successor.version,
        ].join('\u0000')
        if (entry.status === 'superseded' && targetCoordinate === successorCoordinate) {
          issues.push(`${path}.successor must use a different immutable coordinate`)
        }
      }
    }
    if (entry.status === 'superseded' && !record(entry.successor)) {
      issues.push(`${path}.successor is required when status is superseded`)
    }
    if (entry.advisory != null && !validUri(entry.advisory)) {
      issues.push(`${path}.advisory must be an absolute https URI`)
    }
    const key = statusIdentityKey(entry.artifact)
    if (seen.has(key)) issues.push(`${path}.artifact duplicates an earlier status identity`)
    seen.add(key)
  })
  return [...new Set(issues)]
}

export function loadRegistryStatus(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'))
  const issues = validateRegistryStatus(document)
  if (issues.length) throw new Error(`invalid ACX registry status ledger: ${issues.join('; ')}`)
  return {
    document,
    byIdentity: new Map(document.entries.map((entry) => [statusIdentityKey(entry.artifact), entry])),
  }
}

export function activeRegistryStatus() {
  return { status: 'active', reason: null, recordedAt: null, successor: null, advisory: null }
}

export function registryStatusFor(ledger, identity) {
  const entry = ledger?.byIdentity?.get(statusIdentityKey(identity))
  if (!entry) return activeRegistryStatus()
  return {
    status: entry.status,
    reason: entry.reason,
    recordedAt: entry.recordedAt,
    successor: entry.successor ?? null,
    advisory: entry.advisory ?? null,
  }
}
