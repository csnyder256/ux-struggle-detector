import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ReactBabelParser } from '@/lib/parsers/react'

let scratch = ''

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(tmpdir(), 'clarus-react-'))
})

afterAll(async () => {
  if (scratch) await fs.rm(scratch, { recursive: true, force: true })
})

async function writeFile(rel: string, content: string) {
  const abs = path.join(scratch, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}

describe('ReactBabelParser - JSX extraction', () => {
  it('extracts buttons + inputs + forms + links from a TSX file', async () => {
    await writeFile(
      'app/components/SignupForm.tsx',
      `
import { useState } from 'react'
export function SignupForm() {
  const [email, setEmail] = useState('')
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <input type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Create account</button>
      <a href="/help">Need help?</a>
    </form>
  )
}
`,
    )
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_react',
      source: { kind: 'repo', rootDir: scratch },
    })
    const types = map.elements.map((e) => e.elementType).sort()
    expect(types).toContain('FORM')
    expect(types).toContain('INPUT')
    expect(types).toContain('BUTTON')
    expect(types).toContain('LINK')

    const labels = map.elements.map((e) => e.labelRaw)
    expect(labels).toContain('Create account')
    expect(labels).toContain('Need help?')
    expect(labels).toContain('Your email')
  })

  it('captures handler function names from on* props', async () => {
    await writeFile(
      'app/components/Save.tsx',
      `export function Save() {
  return <button onClick={handleSave}>Save</button>
}`,
    )
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_h',
      source: { kind: 'repo', rootDir: scratch },
    })
    const handlers = map.elements
      .filter((e) => e.labelRaw === 'Save')
      .map((e) => e.handlerFunction)
    expect(handlers).toContain('handleSave')
  })

  it('marks inline arrow functions as "(inline)"', async () => {
    await writeFile(
      'app/components/Inline.tsx',
      `export function Inline() {
  return <button onClick={() => alert('hi')}>Click</button>
}`,
    )
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_inline',
      source: { kind: 'repo', rootDir: scratch },
    })
    const click = map.elements.find((e) => e.labelRaw === 'Click')
    expect(click?.handlerFunction).toBe('(inline)')
  })

  it('captures custom components only when they have an interactive prop', async () => {
    await writeFile(
      'app/components/Custom.tsx',
      `export function Page() {
  return (
    <div>
      <Decoration />
      <FancyButton onClick={save}>Submit</FancyButton>
    </div>
  )
}`,
    )
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_c',
      source: { kind: 'repo', rootDir: scratch },
    })
    const customLabels = map.elements
      .filter((e) => e.elementType === 'CUSTOM')
      .map((e) => e.labelRaw)
    expect(customLabels).toContain('Submit')
    expect(customLabels).not.toContain(null) // Decoration shouldn't appear
  })

  it('detects Next.js app/ routes', async () => {
    await writeFile('app/page.tsx', `export default function Home() { return <button>Home</button> }`)
    await writeFile('app/about/page.tsx', `export default function About() { return null }`)
    await writeFile('app/blog/[slug]/page.tsx', `export default function Post() { return null }`)
    await writeFile('app/(auth)/login/page.tsx', `export default function Login() { return null }`)
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_next',
      source: { kind: 'repo', rootDir: scratch },
    })
    const paths = map.routes.map((r) => r.path).sort()
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
    expect(paths).toContain('/blog/[slug]')
    // Route group `(auth)` is transparent.
    expect(paths).toContain('/login')
  })

  it('skips test / spec / .d.ts files', async () => {
    await writeFile('skipped.test.tsx', `export function X() { return <button>Should be skipped</button> }`)
    await writeFile('skipped.spec.tsx', `export function Y() { return <button>Also skipped</button> }`)
    await writeFile('decl.d.ts', `export const Z: 1`)
    await writeFile('keep.tsx', `export function K() { return <button>Keep</button> }`)
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_skip',
      source: { kind: 'repo', rootDir: scratch },
    })
    const labels = map.elements.map((e) => e.labelRaw)
    expect(labels).toContain('Keep')
    expect(labels).not.toContain('Should be skipped')
    expect(labels).not.toContain('Also skipped')
  })

  it('produces stable element ids across runs', async () => {
    await writeFile('stable.tsx', `export function S() { return <button onClick={x}>Persist</button> }`)
    const parser = new ReactBabelParser()
    const a = await parser.parse({
      orgId: 'org_stable_react',
      source: { kind: 'repo', rootDir: scratch },
    })
    const b = await parser.parse({
      orgId: 'org_stable_react',
      source: { kind: 'repo', rootDir: scratch },
    })
    const ids = (m: typeof a) => m.elements.map((e) => e.id).sort()
    expect(ids(a)).toEqual(ids(b))
  })

  it('extracts validation rules from input attributes', async () => {
    await writeFile(
      'app/components/Validated.tsx',
      `export function V() {
  return (
    <form>
      <input type="email" name="email" required minLength={3} maxLength={120} placeholder="you@company.com" />
      <input type="number" name="qty" min={1} max={99} />
      <button type="submit">Save</button>
    </form>
  )
}`,
    )
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_validation',
      source: { kind: 'repo', rootDir: scratch },
    })
    const email = map.elements.find((e) => e.extraction?.name === 'email')
    expect(email?.extraction?.validation?.required).toBe(true)
    expect(email?.extraction?.validation?.inputType).toBe('email')
    expect(email?.extraction?.validation?.minLength).toBe(3)
    expect(email?.extraction?.validation?.maxLength).toBe(120)
    expect(email?.extraction?.placeholder).toBe('you@company.com')

    const qty = map.elements.find((e) => e.extraction?.name === 'qty')
    expect(qty?.extraction?.validation?.min).toBe(1)
    expect(qty?.extraction?.validation?.max).toBe(99)
  })

  it('infers semantic roles from labels and types', async () => {
    await writeFile(
      'app/components/Roles.tsx',
      `export function R() {
  return (
    <div>
      <button type="submit">Save</button>
      <button>Cancel</button>
      <button>Delete account</button>
      <button>Help</button>
      <a href="/search">Search</a>
      <button>Try again</button>
    </div>
  )
}`,
    )
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_roles',
      source: { kind: 'repo', rootDir: scratch },
    })
    function roleFor(label: string) {
      return map.elements.find((e) => e.labelRaw === label)?.extraction?.semanticRole
    }
    expect(roleFor('Save')).toBe('SUBMIT')
    expect(roleFor('Cancel')).toBe('CANCEL')
    expect(roleFor('Delete account')).toBe('DANGER')
    expect(roleFor('Help')).toBe('HELP')
    expect(roleFor('Search')).toBe('SEARCH')
    expect(roleFor('Try again')).toBe('RETRY')

    const danger = map.elements.find((e) => e.labelRaw === 'Delete account')
    expect(danger?.extraction?.destructive).toBe(true)
  })

  it('captures form context + endpoint for nested fields', async () => {
    await writeFile(
      'app/components/Nested.tsx',
      `export function N() {
  return (
    <form id="signupForm" action="/api/signup">
      <input name="email" />
      <button type="submit">Sign up</button>
    </form>
  )
}`,
    )
    const parser = new ReactBabelParser()
    const map = await parser.parse({
      orgId: 'org_form',
      source: { kind: 'repo', rootDir: scratch },
    })
    const email = map.elements.find((e) => e.extraction?.name === 'email')
    expect(email?.extraction?.formContext).toBe('signupForm')

    const form = map.elements.find((e) => e.elementType === 'FORM')
    expect(form?.extraction?.endpoint).toBe('/api/signup')
  })

  it('extracts route metadata: h1 title, sections, auth heuristic', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'clarus-meta-'))
    try {
      await fs.mkdir(path.join(dir, 'app'), { recursive: true })
      await fs.writeFile(
        path.join(dir, 'app', 'page.tsx'),
        `export const metadata = { title: 'Marketing landing', description: 'Welcome to the future.' }
export default function Home() {
  return (
    <main>
      <h1>Welcome home</h1>
      <h2>Why us</h2>
      <h3>Section one</h3>
    </main>
  )
}`,
      )
      await fs.mkdir(path.join(dir, 'app', 'dashboard'), { recursive: true })
      await fs.writeFile(
        path.join(dir, 'app', 'dashboard', 'page.tsx'),
        `import { auth } from '@/lib/auth'
export default async function D() {
  const s = await auth()
  if (!s) redirect('/sign-in')
  return <h1>Your dashboard</h1>
}`,
      )

      const parser = new ReactBabelParser()
      const map = await parser.parse({
        orgId: 'org_meta',
        source: { kind: 'repo', rootDir: dir },
      })

      const home = map.routes.find((r) => r.path === '/')
      expect(home?.extraction?.title).toBe('Marketing landing')
      expect(home?.extraction?.description).toBe('Welcome to the future.')
      expect(home?.extraction?.sections).toContain('Why us')

      const dashboard = map.routes.find((r) => r.path === '/dashboard')
      expect(dashboard?.extraction?.title).toBe('Your dashboard')
      expect(dashboard?.extraction?.authRequired).toBe(true)
      expect(dashboard?.extraction?.sourceFile).toMatch(/dashboard\/page\.tsx$/)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('detects Remix flat routes', async () => {
    // Remix project has no app/page.tsx - only app/routes/*.tsx - so route
    // scanning falls through to Remix.
    const remixDir = await fs.mkdtemp(path.join(tmpdir(), 'clarus-remix-'))
    try {
      await fs.mkdir(path.join(remixDir, 'app', 'routes'), { recursive: true })
      await fs.writeFile(
        path.join(remixDir, 'app', 'routes', '_index.tsx'),
        `export default function Idx() { return <button>Home</button> }`,
      )
      await fs.writeFile(
        path.join(remixDir, 'app', 'routes', 'about.tsx'),
        `export default function A() { return null }`,
      )
      await fs.writeFile(
        path.join(remixDir, 'app', 'routes', 'blog.$slug.tsx'),
        `export default function P() { return null }`,
      )
      const parser = new ReactBabelParser()
      const map = await parser.parse({
        orgId: 'org_remix',
        source: { kind: 'repo', rootDir: remixDir },
      })
      const paths = map.routes.map((r) => r.path).sort()
      expect(paths).toContain('/')
      expect(paths).toContain('/about')
      expect(paths).toContain('/blog/:slug')
    } finally {
      await fs.rm(remixDir, { recursive: true, force: true })
    }
  })
})
