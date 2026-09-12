import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
const dir = 'dist/assets'

// беремо НАЙНОВІШІ файли: теку не чистимо, тож старі збірки лишаються поруч
const newest = (ext) => readdirSync(dir)
  .filter(f => f.endsWith(ext))
  .map(f => ({ f, m: statSync(`${dir}/${f}`).mtimeMs }))
  .sort((a, b) => b.m - a.m)[0].f

const js = readFileSync(`${dir}/${newest('.js')}`, 'utf8')
const css = readFileSync(`${dir}/${newest('.css')}`, 'utf8')

writeFileSync('dist/family-flow.html',
`<!doctype html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Family Flow</title><style>${css}</style></head>
<body><div id="root"></div><script type="module">${js}</script></body></html>`)

writeFileSync('dist/artifact.html',
`<title>Family Flow</title>\n<style>${css}</style>\n<div id="root"></div>\n<script type="module">${js}</script>`)
console.log('single file ready from', newest('.js'))
