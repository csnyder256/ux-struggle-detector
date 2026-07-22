import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { UniversalHtmlParser } from '@/lib/parsers/universal-html'

let scratch = ''

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(tmpdir(), 'clarus-uparser-'))
})

afterAll(async () => {
  if (scratch) await fs.rm(scratch, { recursive: true, force: true })
})

async function writeFile(rel: string, content: string) {
  const abs = path.join(scratch, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}

describe('UniversalHtmlParser', () => {
  it('extracts buttons + links + inputs from a Vue SFC', async () => {
    await writeFile(
      'app.vue',
      `<template>
        <form @submit="onSubmit">
          <input v-model="name" placeholder="Your name" />
          <button @click="reset">Cancel</button>
          <button type="submit">Save changes</button>
        </form>
        <a href="/help">Need help?</a>
      </template>`,
    )
    const parser = new UniversalHtmlParser('vue')
    const map = await parser.parse({
      orgId: 'org_test',
      source: { kind: 'repo', rootDir: scratch },
    })
    const types = map.elements.map((e) => e.elementType).sort()
    expect(types).toContain('BUTTON')
    expect(types).toContain('INPUT')
    expect(types).toContain('FORM')
    expect(types).toContain('LINK')

    const labels = map.elements.map((e) => e.labelRaw)
    expect(labels).toContain('Save changes')
    expect(labels).toContain('Cancel')
    expect(labels).toContain('Need help?')
    expect(labels).toContain('Your name')
  })

  it('produces stable element ids across runs', async () => {
    await writeFile(
      'stable.svelte',
      `<button on:click={save}>Persist</button>`,
    )
    const parser = new UniversalHtmlParser('svelte')
    const a = await parser.parse({
      orgId: 'org_stable',
      source: { kind: 'repo', rootDir: scratch },
    })
    const b = await parser.parse({
      orgId: 'org_stable',
      source: { kind: 'repo', rootDir: scratch },
    })
    expect(a.elements.map((e) => e.id)).toEqual(b.elements.map((e) => e.id))
  })

  it('captures handler function names from on*= attributes', async () => {
    await writeFile(
      'handlers.html',
      `<button onclick="handleSave()">Save</button>
       <button @click="cancelEdit">Cancel</button>`,
    )
    const parser = new UniversalHtmlParser('html')
    const map = await parser.parse({
      orgId: 'org_h',
      source: { kind: 'repo', rootDir: scratch },
    })
    const handlers = map.elements.map((e) => e.handlerFunction).filter(Boolean)
    expect(handlers).toContain('handleSave')
    expect(handlers).toContain('cancelEdit')
  })

  it('captures custom-component HTMX hx-* and Alpine x-on:* elements', async () => {
    await writeFile(
      'htmx.html',
      `<div hx-get="/api/count" hx-trigger="click">Click for count</div>
       <span x-on:click="open = true">Open menu</span>`,
    )
    const parser = new UniversalHtmlParser('htmx')
    const map = await parser.parse({
      orgId: 'org_x',
      source: { kind: 'repo', rootDir: scratch },
    })
    const customs = map.elements.filter((e) => e.elementType === 'CUSTOM')
    expect(customs.length).toBeGreaterThanOrEqual(2)
  })

  it('hashes element labels when labelRaw is set', async () => {
    await writeFile(
      'labels.vue',
      `<template><button>Submit</button></template>`,
    )
    const parser = new UniversalHtmlParser('vue')
    const map = await parser.parse({
      orgId: 'org_l',
      source: { kind: 'repo', rootDir: scratch },
    })
    const submit = map.elements.find((e) => e.labelRaw === 'Submit')
    expect(submit).toBeDefined()
    expect(submit?.labelHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('skips files in node_modules / dist / .next', async () => {
    await writeFile('node_modules/skip.vue', `<button>Should be skipped</button>`)
    await writeFile('dist/skip.html', `<button>Also skipped</button>`)
    await writeFile('keep.vue', `<button>Keep me</button>`)
    const parser = new UniversalHtmlParser('vue')
    const map = await parser.parse({
      orgId: 'org_skip',
      source: { kind: 'repo', rootDir: scratch },
    })
    const labels = map.elements.map((e) => e.labelRaw)
    expect(labels.filter((l) => l === 'Keep me').length).toBeGreaterThan(0)
    expect(labels.filter((l) => l === 'Should be skipped').length).toBe(0)
    expect(labels.filter((l) => l === 'Also skipped').length).toBe(0)
  })
})

describe('UniversalHtmlParser - route detection', () => {
  it('extracts Nuxt-style routes from pages/', async () => {
    await writeFile('routes-nuxt/pages/index.vue', `<template></template>`)
    await writeFile('routes-nuxt/pages/about.vue', `<template></template>`)
    await writeFile('routes-nuxt/pages/users/[id].vue', `<template></template>`)
    const parser = new UniversalHtmlParser('vue')
    const map = await parser.parse({
      orgId: 'org_nuxt',
      source: { kind: 'repo', rootDir: path.join(scratch, 'routes-nuxt') },
    })
    const paths = map.routes.map((r) => r.path).sort()
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
    expect(paths).toContain('/users/:id')
  })

  it('extracts SvelteKit routes from src/routes/', async () => {
    await writeFile('routes-sk/src/routes/+page.svelte', `<button>Home</button>`)
    await writeFile('routes-sk/src/routes/blog/+page.svelte', `<button>Blog</button>`)
    await writeFile('routes-sk/src/routes/blog/+layout.svelte', `<slot />`)
    await writeFile('routes-sk/src/routes/blog/[slug]/+page.svelte', ``)
    const parser = new UniversalHtmlParser('svelte')
    const map = await parser.parse({
      orgId: 'org_sk',
      source: { kind: 'repo', rootDir: path.join(scratch, 'routes-sk') },
    })
    const paths = map.routes.map((r) => r.path).sort()
    expect(paths).toContain('/')
    expect(paths).toContain('/blog')
    expect(paths).toContain('/blog/:slug')
    // +layout shouldn't produce a route.
    expect(paths.find((p) => p.includes('+layout'))).toBeUndefined()
  })

  it('extracts Astro routes from src/pages/', async () => {
    await writeFile('routes-astro/src/pages/index.astro', `<a href="/about">about</a>`)
    await writeFile('routes-astro/src/pages/about.astro', ``)
    await writeFile('routes-astro/src/pages/blog/[slug].astro', ``)
    const parser = new UniversalHtmlParser('astro')
    const map = await parser.parse({
      orgId: 'org_a',
      source: { kind: 'repo', rootDir: path.join(scratch, 'routes-astro') },
    })
    const paths = map.routes.map((r) => r.path).sort()
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
    expect(paths).toContain('/blog/:slug')
  })

  it('extracts Hugo content routes', async () => {
    await writeFile('routes-hugo/content/_index.md', '')
    await writeFile('routes-hugo/content/posts/hello.md', '')
    await writeFile('routes-hugo/content/about.md', '')
    const parser = new UniversalHtmlParser('hugo')
    const map = await parser.parse({
      orgId: 'org_h',
      source: { kind: 'repo', rootDir: path.join(scratch, 'routes-hugo') },
    })
    const paths = map.routes.map((r) => r.path).sort()
    expect(paths).toContain('/about')
    expect(paths.some((p) => p.endsWith('hello'))).toBe(true)
  })
})
