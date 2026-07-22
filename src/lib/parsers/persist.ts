/**
 * Persistence helpers for parser output. Keeps the route handlers thin and
 * the cleanup semantics in one place.
 *
 * Re-mapping is destructive on purpose: the old UIElement / UIRoute rows for
 * the org are deleted before new ones are inserted. UserEvent rows reference
 * UIElement via ON DELETE SET NULL, so historical events keep their route +
 * sessionId but lose the element link. This is the right tradeoff - stale
 * elements would otherwise accumulate forever.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { detectFrameworks, mapRepository, pickPrimary } from '@/lib/parsers'

export interface MapAndPersistResult {
  ok: boolean
  error?: string
  frameworkName?: string
  elements?: number
  routes?: number
  detected?: number
}

export async function mapAndPersist(orgId: string, sourcePath: string): Promise<MapAndPersistResult> {
  const isLocalPath = !sourcePath.startsWith('http://') && !sourcePath.startsWith('https://')
  if (!isLocalPath) {
    await prisma.platformConfig.update({
      where: { orgId },
      data: { repoUrl: sourcePath },
    })
    return {
      ok: false,
      error: 'Saved git URL on the platform config. Remote git mapping runs via the GitHub App flow (see /onboarding/github).',
    }
  }

  let absPath = sourcePath
  try {
    absPath = path.resolve(absPath)
    const stat = await fs.stat(absPath)
    if (!stat.isDirectory()) {
      return { ok: false, error: 'Path exists but is not a directory.' }
    }
  } catch {
    return {
      ok: false,
      error: 'Path not found or not readable on the server filesystem. Make sure the dev server has access to it.',
    }
  }

  await prisma.platformConfig.upsert({
    where: { orgId },
    create: {
      orgId,
      platformName: path.basename(absPath),
      platformDescription: '',
      repoUrl: absPath,
    },
    update: { repoUrl: absPath },
  })

  // Detect frameworks (best-effort log + return).
  const detections = await detectFrameworks({ rootDir: absPath })
  const primary = pickPrimary(detections)
  if (!primary) {
    return {
      ok: false,
      error:
        "No supported framework detected. Make sure the path points at the project root (the directory containing package.json or the framework's config file).",
    }
  }

  for (const d of detections) {
    await prisma.detectedFramework.create({
      data: {
        orgId,
        frameworkId: d.framework.id,
        confidence: d.confidence,
        evidence: JSON.parse(JSON.stringify(d.evidence)),
      },
    })
  }

  const result = await mapRepository({ orgId, rootDir: absPath })
  if (result.error || !result.uiMap) {
    return { ok: false, error: `Mapping failed: ${result.error ?? 'unknown error'}` }
  }

  // Destructive re-map: clear stale rows first so the inventory matches the
  // current state of the source.
  await prisma.uIElement.deleteMany({ where: { orgId } })
  await prisma.uIRoute.deleteMany({ where: { orgId } })

  if (result.uiMap.elements.length > 0) {
    const data = result.uiMap.elements.map((e) => ({
      id: e.id,
      orgId,
      filePath: e.filePath,
      componentName: e.componentName,
      elementType: e.elementType,
      labelRaw: e.labelRaw,
      labelHash: e.labelHash,
      handlerFunction: e.handlerFunction,
      routeTarget: e.routeTarget,
      extraction: (e.extraction ?? {}) as never,
      semanticRole: e.extraction?.semanticRole ?? null,
      formContext: e.extraction?.formContext ?? null,
    }))
    await prisma.uIElement.createMany({ data, skipDuplicates: true })
  }

  if (result.uiMap.routes.length > 0) {
    for (const r of result.uiMap.routes) {
      const create = {
        orgId,
        path: r.path,
        parentPath: r.parentPath,
        entryPoints: r.extraction ? (r.entryPoints as never) : (r.entryPoints as never),
        title: r.extraction?.title ?? null,
        description: r.extraction?.description ?? null,
        sourceFile: r.extraction?.sourceFile ?? null,
        authRequired: r.extraction?.authRequired ?? false,
        extraction: (r.extraction ?? {}) as never,
      }
      const update = {
        parentPath: r.parentPath,
        entryPoints: r.entryPoints as never,
        title: r.extraction?.title ?? null,
        description: r.extraction?.description ?? null,
        sourceFile: r.extraction?.sourceFile ?? null,
        authRequired: r.extraction?.authRequired ?? false,
        extraction: (r.extraction ?? {}) as never,
      }
      await prisma.uIRoute.upsert({
        where: { orgId_path: { orgId, path: r.path } },
        create: create as never,
        update: update as never,
      })
    }
  }

  return {
    ok: true,
    frameworkName: primary.framework.name,
    elements: result.uiMap.elements.length,
    routes: result.uiMap.routes.length,
    detected: detections.length,
  }
}
