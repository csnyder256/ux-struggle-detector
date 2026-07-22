/**
 * Framework registry - every framework, build tool, or templating system the
 * platform knows about. Each entry has detection rules (which package.json
 * deps, config files, or file extensions identify the framework) and a
 * parser-status flag.
 *
 * Adding a new entry: append to FRAMEWORKS below. If you also have a real
 * parser for it, plug it into PARSERS in `index.ts`. Otherwise it gets a
 * BaseStubParser and shows up as "planned" in the dashboard.
 */

import type { FrameworkMetadata } from './types'

export const FRAMEWORKS: FrameworkMetadata[] = [
  // ── React family ────────────────────────────────────────────────────────
  {
    id: 'next',
    name: 'Next.js',
    family: 'react',
    description: 'React framework with file-based routing (app/ and pages/), SSR, and server components.',
    homepage: 'https://nextjs.org',
    detection: {
      packageDeps: ['next'],
      configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },
  {
    id: 'remix',
    name: 'Remix',
    family: 'react',
    description: 'React framework with nested routing, loaders, and actions.',
    homepage: 'https://remix.run',
    detection: {
      packageDeps: ['@remix-run/react', '@remix-run/node', '@remix-run/dev'],
      configFiles: ['remix.config.js', 'remix.config.mjs'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },
  {
    id: 'tanstack-start',
    name: 'TanStack Start',
    family: 'react',
    description: 'Full-stack React framework built on TanStack Router.',
    homepage: 'https://tanstack.com/start',
    detection: {
      packageDeps: ['@tanstack/start', '@tanstack/react-router'],
    },
    parserStatus: 'beta',
    detectionPriority: 88,
  },
  {
    id: 'tanstack-router',
    name: 'TanStack Router',
    family: 'react',
    description: 'Type-safe React routing with file-based or code-based routes.',
    homepage: 'https://tanstack.com/router',
    detection: {
      packageDeps: ['@tanstack/react-router', '@tanstack/router-plugin'],
    },
    parserStatus: 'beta',
    detectionPriority: 70,
  },
  {
    id: 'react-router',
    name: 'React Router',
    family: 'react',
    description: 'The original React routing library; works with any React app.',
    homepage: 'https://reactrouter.com',
    detection: {
      packageDeps: ['react-router', 'react-router-dom'],
    },
    parserStatus: 'beta',
    detectionPriority: 60,
  },
  {
    id: 'cra',
    name: 'Create React App',
    family: 'react',
    description: 'Classic React tooling. Webpack under the hood; no built-in routing.',
    homepage: 'https://create-react-app.dev',
    detection: {
      packageDeps: ['react-scripts'],
    },
    parserStatus: 'beta',
    detectionPriority: 50,
  },
  {
    id: 'gatsby',
    name: 'Gatsby',
    family: 'react',
    description: 'React-based SSG with GraphQL-driven content layer.',
    homepage: 'https://www.gatsbyjs.com',
    detection: {
      packageDeps: ['gatsby'],
      configFiles: ['gatsby-config.js', 'gatsby-config.ts'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'docusaurus-v2',
    name: 'Docusaurus 2+',
    family: 'react',
    description: 'React + MDX documentation framework. Auto-generated sidebars and routing.',
    homepage: 'https://docusaurus.io',
    detection: {
      packageDeps: ['@docusaurus/core', '@docusaurus/preset-classic'],
      configFiles: ['docusaurus.config.js', 'docusaurus.config.ts'],
    },
    parserStatus: 'beta',
    detectionPriority: 85,
  },
  {
    id: 'docusaurus-v1',
    name: 'Docusaurus 1',
    family: 'react',
    description: 'Legacy Docusaurus. Markdown + simple React shell.',
    detection: {
      packageDeps: ['docusaurus'],
      configFiles: ['siteConfig.js'],
    },
    parserStatus: 'beta',
    detectionPriority: 70,
  },
  {
    id: 'hydrogen',
    name: 'Hydrogen',
    family: 'react',
    description: 'Shopify\'s React framework for storefronts (Remix under the hood).',
    homepage: 'https://hydrogen.shopify.dev',
    detection: {
      packageDeps: ['@shopify/hydrogen', '@shopify/hydrogen-react'],
    },
    parserStatus: 'beta',
    detectionPriority: 88,
  },
  {
    id: 'ionic-react',
    name: 'Ionic React',
    family: 'react',
    description: 'Mobile-first hybrid app framework using React.',
    homepage: 'https://ionicframework.com/docs/react',
    detection: {
      packageDeps: ['@ionic/react', '@ionic/react-router'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'react',
    name: 'React (raw)',
    family: 'react',
    description: 'Plain React without an opinionated framework. Usually paired with Vite or Webpack.',
    homepage: 'https://react.dev',
    detection: {
      packageDeps: ['react', 'react-dom'],
    },
    parserStatus: 'beta',
    detectionPriority: 10,
  },

  // ── Preact ──────────────────────────────────────────────────────────────
  {
    id: 'preact',
    name: 'Preact',
    family: 'preact',
    description: 'Tiny React-compatible alternative.',
    homepage: 'https://preactjs.com',
    detection: { packageDeps: ['preact'] },
    parserStatus: 'beta',
    detectionPriority: 50,
  },
  {
    id: 'fresh',
    name: 'Fresh',
    family: 'fresh',
    description: 'Deno full-stack framework using Preact + islands architecture.',
    homepage: 'https://fresh.deno.dev',
    detection: {
      packageDeps: ['$fresh'],
      configFiles: ['fresh.config.ts', 'deno.json'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },

  // ── Vue family ──────────────────────────────────────────────────────────
  {
    id: 'nuxt',
    name: 'Nuxt',
    family: 'vue',
    description: 'Vue framework with file-based routing, server routes, and SSR.',
    homepage: 'https://nuxt.com',
    detection: {
      packageDeps: ['nuxt', 'nuxt3'],
      configFiles: ['nuxt.config.js', 'nuxt.config.ts'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },
  {
    id: 'gridsome',
    name: 'Gridsome',
    family: 'vue',
    description: 'Vue-based static site generator with GraphQL data layer.',
    homepage: 'https://gridsome.org',
    detection: {
      packageDeps: ['gridsome'],
      configFiles: ['gridsome.config.js'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'saber',
    name: 'Saber',
    family: 'vue',
    description: 'Vue.js static site framework for content-driven sites.',
    detection: {
      packageDeps: ['saber'],
      configFiles: ['saber-config.js'],
    },
    parserStatus: 'beta',
    detectionPriority: 70,
  },
  {
    id: 'vue',
    name: 'Vue (raw)',
    family: 'vue',
    description: 'Plain Vue without an opinionated framework. Usually paired with Vite.',
    homepage: 'https://vuejs.org',
    detection: {
      packageDeps: ['vue'],
      fileExtensions: ['.vue'],
    },
    parserStatus: 'beta',
    detectionPriority: 10,
  },

  // ── Svelte family ───────────────────────────────────────────────────────
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    family: 'svelte',
    description: 'Svelte framework with file-based routing, server actions, and adapters.',
    homepage: 'https://kit.svelte.dev',
    detection: {
      packageDeps: ['@sveltejs/kit'],
      configFiles: ['svelte.config.js'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },
  {
    id: 'svelte',
    name: 'Svelte (raw)',
    family: 'svelte',
    description: 'Plain Svelte without SvelteKit. Usually paired with Vite.',
    homepage: 'https://svelte.dev',
    detection: {
      packageDeps: ['svelte'],
      fileExtensions: ['.svelte'],
    },
    parserStatus: 'beta',
    detectionPriority: 20,
  },

  // ── Angular family ──────────────────────────────────────────────────────
  {
    id: 'angular',
    name: 'Angular',
    family: 'angular',
    description: 'Full-featured TypeScript-first framework with the Angular CLI.',
    homepage: 'https://angular.dev',
    detection: {
      packageDeps: ['@angular/core', '@angular/cli'],
      configFiles: ['angular.json'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },
  {
    id: 'ionic-angular',
    name: 'Ionic Angular',
    family: 'angular',
    description: 'Mobile-first hybrid app framework using Angular.',
    homepage: 'https://ionicframework.com/docs/angular',
    detection: {
      packageDeps: ['@ionic/angular'],
    },
    parserStatus: 'beta',
    detectionPriority: 88,
  },

  // ── Astro ───────────────────────────────────────────────────────────────
  {
    id: 'astro',
    name: 'Astro',
    family: 'astro',
    description: 'Multi-framework static + SSR with islands. Mixes React/Vue/Svelte/Solid components.',
    homepage: 'https://astro.build',
    detection: {
      packageDeps: ['astro'],
      configFiles: ['astro.config.js', 'astro.config.mjs', 'astro.config.ts'],
      fileExtensions: ['.astro'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },

  // ── Solid family ────────────────────────────────────────────────────────
  {
    id: 'solid-start',
    name: 'SolidStart',
    family: 'solid',
    description: 'Full-stack framework for Solid.js with file-based routing.',
    homepage: 'https://start.solidjs.com',
    detection: {
      packageDeps: ['@solidjs/start'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },
  {
    id: 'solid',
    name: 'Solid.js',
    family: 'solid',
    description: 'Reactive UI library with fine-grained updates. JSX-based.',
    homepage: 'https://www.solidjs.com',
    detection: {
      packageDeps: ['solid-js'],
    },
    parserStatus: 'beta',
    detectionPriority: 50,
  },

  // ── Qwik ────────────────────────────────────────────────────────────────
  {
    id: 'qwik-city',
    name: 'QwikCity',
    family: 'qwik',
    description: 'Full-stack meta-framework for Qwik with resumability.',
    homepage: 'https://qwik.dev',
    detection: { packageDeps: ['@builder.io/qwik-city'] },
    parserStatus: 'beta',
    detectionPriority: 90,
  },
  {
    id: 'qwik',
    name: 'Qwik',
    family: 'qwik',
    description: 'Resumable JS framework. Zero hydration.',
    detection: { packageDeps: ['@builder.io/qwik'] },
    parserStatus: 'beta',
    detectionPriority: 50,
  },

  // ── Web components ──────────────────────────────────────────────────────
  {
    id: 'lit',
    name: 'Lit',
    family: 'lit',
    description: 'Lightweight web components library from Google.',
    homepage: 'https://lit.dev',
    detection: { packageDeps: ['lit'] },
    parserStatus: 'beta',
    detectionPriority: 40,
  },
  {
    id: 'stencil',
    name: 'Stencil',
    family: 'stencil',
    description: 'Compiler that builds standards-compliant web components.',
    homepage: 'https://stenciljs.com',
    detection: {
      packageDeps: ['@stencil/core'],
      configFiles: ['stencil.config.ts', 'stencil.config.js'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'polymer',
    name: 'Polymer',
    family: 'polymer',
    description: 'Web components library (largely superseded by Lit).',
    homepage: 'https://polymer-library.polymer-project.org',
    detection: {
      packageDeps: ['@polymer/polymer'],
      configFiles: ['polymer.json'],
    },
    parserStatus: 'beta',
    detectionPriority: 70,
  },

  // ── Other JS frameworks ─────────────────────────────────────────────────
  {
    id: 'ember',
    name: 'Ember.js',
    family: 'ember',
    description: 'Convention-over-config full-stack JS framework.',
    homepage: 'https://emberjs.com',
    detection: {
      packageDeps: ['ember-cli', 'ember-source'],
      configFiles: ['ember-cli-build.js'],
    },
    parserStatus: 'beta',
    detectionPriority: 90,
  },
  {
    id: 'dojo',
    name: 'Dojo',
    family: 'dojo',
    description: 'Reactive TypeScript framework with widget system.',
    homepage: 'https://dojo.io',
    detection: {
      packageDeps: ['@dojo/framework'],
      configFiles: ['.dojorc'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'mithril',
    name: 'Mithril',
    family: 'mithril',
    description: 'Tiny SPA framework with hyperscript-style components.',
    homepage: 'https://mithril.js.org',
    detection: { packageDeps: ['mithril'] },
    parserStatus: 'beta',
    detectionPriority: 50,
  },
  {
    id: 'marko',
    name: 'Marko',
    family: 'marko',
    description: 'eBay\'s component-based UI framework with built-in streaming.',
    homepage: 'https://markojs.com',
    detection: {
      packageDeps: ['marko'],
      fileExtensions: ['.marko'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'aurelia',
    name: 'Aurelia',
    family: 'aurelia',
    description: 'Convention-based JS/TS framework with two-way binding.',
    homepage: 'https://aurelia.io',
    detection: { packageDeps: ['aurelia-framework', 'aurelia'] },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'alpine',
    name: 'Alpine.js',
    family: 'alpine',
    description: 'Lightweight reactive declarations sprinkled into HTML.',
    homepage: 'https://alpinejs.dev',
    detection: { packageDeps: ['alpinejs'] },
    parserStatus: 'beta',
    detectionPriority: 30,
  },
  {
    id: 'htmx',
    name: 'HTMX',
    family: 'htmx',
    description: 'Hypermedia-driven UI via HTML attributes; pairs with any backend.',
    homepage: 'https://htmx.org',
    detection: {
      packageDeps: ['htmx.org'],
    },
    parserStatus: 'beta',
    detectionPriority: 40,
  },
  {
    id: 'fasthtml',
    name: 'FastHTML',
    family: 'fasthtml',
    description: 'Python web framework that emits HTMX-driven HTML server-side.',
    homepage: 'https://fastht.ml',
    detection: {
      configFiles: ['main.py', 'pyproject.toml'],
    },
    parserStatus: 'beta',
    detectionPriority: 70,
  },

  // ── Static site generators ──────────────────────────────────────────────
  {
    id: 'eleventy',
    name: 'Eleventy (11ty)',
    family: 'ssg',
    description: 'JavaScript SSG that supports Nunjucks, Liquid, EJS, Markdown, and more.',
    homepage: 'https://www.11ty.dev',
    detection: {
      packageDeps: ['@11ty/eleventy'],
      configFiles: ['.eleventy.js', 'eleventy.config.js', 'eleventy.config.mjs'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'hexo',
    name: 'Hexo',
    family: 'ssg',
    description: 'Fast Node.js static blog framework.',
    homepage: 'https://hexo.io',
    detection: {
      packageDeps: ['hexo'],
      configFiles: ['_config.yml'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'hugo',
    name: 'Hugo',
    family: 'ssg',
    description: 'Go-powered SSG. Lightning fast builds, Go templates.',
    homepage: 'https://gohugo.io',
    detection: {
      configFiles: ['config.toml', 'config.yaml', 'hugo.toml', 'hugo.yaml', 'hugo.config.toml'],
    },
    parserStatus: 'beta',
    detectionPriority: 80,
  },
  {
    id: 'jekyll',
    name: 'Jekyll',
    family: 'ssg',
    description: 'Ruby SSG using Liquid templates. Powers GitHub Pages.',
    homepage: 'https://jekyllrb.com',
    detection: {
      configFiles: ['_config.yml', 'Gemfile'],
    },
    parserStatus: 'beta',
    detectionPriority: 70,
  },
  {
    id: 'middleman',
    name: 'Middleman',
    family: 'ssg',
    description: 'Ruby SSG using ERB / Slim / Haml. Asset pipeline included.',
    homepage: 'https://middlemanapp.com',
    detection: {
      configFiles: ['config.rb', 'Gemfile'],
    },
    parserStatus: 'beta',
    detectionPriority: 70,
  },

  // ── Build tools (delegate to underlying framework) ──────────────────────
  {
    id: 'vite',
    name: 'Vite',
    family: 'build-tool',
    description: 'Build tool. The actual framework is detected from package.json deps (React, Vue, Svelte, Solid, etc.).',
    homepage: 'https://vitejs.dev',
    detection: {
      packageDeps: ['vite'],
      configFiles: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
    },
    parserStatus: 'beta',
    detectionPriority: 5,
  },
  {
    id: 'parcel',
    name: 'Parcel',
    family: 'build-tool',
    description: 'Zero-config build tool. Underlying framework is detected separately.',
    homepage: 'https://parceljs.org',
    detection: { packageDeps: ['parcel'] },
    parserStatus: 'beta',
    detectionPriority: 5,
  },
  {
    id: 'brunch',
    name: 'Brunch',
    family: 'build-tool',
    description: 'Older fast JS bundler. Underlying framework detected separately.',
    homepage: 'https://brunch.io',
    detection: {
      packageDeps: ['brunch'],
      configFiles: ['brunch-config.js', 'brunch-config.coffee'],
    },
    parserStatus: 'beta',
    detectionPriority: 5,
  },
]

/** Lookup by id. Throws if not found. */
export function getFramework(id: string): FrameworkMetadata {
  const f = FRAMEWORKS.find((x) => x.id === id)
  if (!f) throw new Error(`Unknown framework id: ${id}`)
  return f
}

export function frameworksByFamily(family: FrameworkMetadata['family']): FrameworkMetadata[] {
  return FRAMEWORKS.filter((f) => f.family === family)
}

/** Stable count of how many frameworks the registry tracks; surfaced on the landing page. */
export const FRAMEWORK_COUNT = FRAMEWORKS.length
