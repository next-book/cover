import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import favicons, { FaviconResponse } from 'favicons'
import sharp from 'sharp'
import { chromium, Page } from 'playwright-chromium'
import { randomUUID } from 'crypto'
import Color from 'color'

const DEBUG = false 
/**
 * Toggle browser headlessness 
 * 
 * User os theme might change the result screenshots when running browser
 * in head-full mode eg. by applying user’s OS prefers-color-scheme.
 */
const DEVTOOLS = false
const hostname = '127.0.0.1'
const port = 9137

enum Cover {
  AMAZON = 'amazon', // amazon recommended e-book cover size
  TWITTER = 'twitter', // twitter OG
  FACEBOOK = 'facebook', // FB OG image
  MKP = 'mkp', // original e-book cover size
}

interface Meta {
  title: string
  author: string
  published?: number
}

type Dictionary<T> = { [key: string]: T }

interface IconSize {
  width: number
  height: number
}

interface IconOptions {
  sizes: IconSize[]
  offset?: number
  background?: string | boolean
  transparent: boolean
  rotate: boolean
  purpose?: string
  pixelArt?: boolean
}

type Icons = Dictionary<IconOptions | boolean | string[]>

interface CoverGenerationOptions {
  disableImageGeneration: boolean
  disableCoverGeneration: boolean
  covers: Cover[] // set cover sizes
  disableIconsGeneration: boolean
  sourceIcon?: string // custom icon to be resized path
  icons: Icons // allowed icon platforms
  disableIconColorDetection: boolean
  assetDir: string // directory to store assets to. default 'assets'
  disableOgMetaGeneration: boolean
  disableTwitterMetaGeneration: boolean
  disableManifestGeneration: boolean
  disableBrowserConfigGeneration: boolean
  name?: string // app name, defaults to book name
  shortName?: string // defaults to book name
  description?: string
  startUrl?: string // default to '/'
  themeColor?: string | 'detect' // default to '#fff'
}

interface Config {
  meta: Meta
  coverGenerationOptions: CoverGenerationOptions 
}

const defaultMeta = {
  title: 'No Title',
  author: 'No Author',
}
const defaultOptions: CoverGenerationOptions = {
  disableImageGeneration: false,
  disableCoverGeneration: false,
  covers: [Cover.AMAZON, Cover.FACEBOOK, Cover.TWITTER, Cover.MKP],
  disableIconsGeneration: false,
  disableIconColorDetection: false,
  icons: {
    android: true,
    appleIcon: true,
    appleStartup: false,
    favicons: true,
    windows: false,
    yandex: false,
  },
  assetDir: 'assets',
  disableOgMetaGeneration: false,
  disableTwitterMetaGeneration: false,
  disableManifestGeneration: false,
  disableBrowserConfigGeneration: true,
}

type CoverSize = {
  width: number
  height: number
  name: Cover | string
  metaProperty?: string
}
const coverSizes: CoverSize[] = [
  {
    width: 1200,
    height: 1200,
    name: Cover.TWITTER,
    metaProperty: 'twitter:image',
  },
  { width: 1600, height: 2560, name: Cover.AMAZON },
  {
    width: 1200,
    height: 620,
    name: Cover.FACEBOOK,
    metaProperty: 'og:image',
  },
  { width: 398, height: 566, name: Cover.MKP },
]
//type IconSize = { size: number; name: Icon | string }
//const iconSizes: IconSize[] = [{ size: 64, name: Icon.Apple }]

const isSizes = <T>(sizes: (undefined | T)[]): sizes is T[] =>
  !sizes.includes(undefined)

// https://www.w3.org/TR/appmanifest/#manifest-image-resources
type WamImageObject = {
  src: string
  sizes?: string
  type?: string
  label?: string
  purpose?: string
}

type IconColors = {
  background?: string
  title?: string
}

async function generateIcon (
  bookPath: string,
  author: string,
  assetDir: string,
  page: Page,
  iconColors: IconColors
): Promise<string> {
  const result: WamImageObject[] = []

  const gridIcon = await fs.readFile(
    path.join(__dirname, '../assets/icon-grid.svg'),
    {
      encoding: 'utf8',
    }
  )
  const coverHtml = await fs.readFile(path.join(bookPath, 'index.html'), {
    encoding: 'utf8',
  })
  const inBetweenHeadTag = /(?<=(<head>))((.|\n)*?)(?=(<\/head>))/
  const match = inBetweenHeadTag.exec(coverHtml)
  const originalHead = match !== null ? match[0] : ''
  const html = getIconHtml({
    author,
    gridIcon,
    originalHead,
    backgroundColor: iconColors.background,
    titleColor: iconColors.title,
  })
  const name = randomUUID()
  const filename = path.join(bookPath, `${name}.html`)
  await fs.writeFile(filename, html)
  // take screenshot
  await page.goto(`${hostname}:${port}/${name}.html`)
  await page.setViewportSize({
    width: 1080,
    height: 1080,
  })
  const iconfile = `${assetDir}/icon.png`
  await page
    .locator('#book-generator-icon')
    .screenshot({ path: iconfile, scale: 'css' })
  // todo: push dynamic result
  result.push({
    src: iconfile,
    sizes: '1024x1024',
    type: 'image/png',
  })
  if (DEBUG) {
    console.log(
      `temporary icon generation page ${name}.html left without deletion`
    )
    return iconfile
  }
  // remove the page from book’s directory
  await fs.unlink(filename)
  return iconfile
}

/**
 * Abbreviates author’s name
 *
 * @example Name with lowercase part in the middle
 * > authorShort('John lowercase Doe')
 * JlD
 */
export const authorShort = (author: string) =>
  author
    .split(/\s+/)
    .map((part) => part[0])
    .join('')

export const titleShort = (title: string) =>
  title
    .split(/\b(?=[a-z])/gi)
    .map((part) =>
      part[part.length - 1] === '.' ? part : part[0].toLowerCase()
    )
    .join('')

// https://w3c.github.io/pub-manifest/#cover
interface LinkedResource {
  type?: string
  url: string
  encodingFormat?: string
  name?: string
  description?: string
  rel?: string
  integrity?: string
  duration?: string
  alternate?: string | LinkedResource[]
}

// https://www.w3.org/TR/manifest-app-info/#screenshot-object-and-its-members
// interface WamScreenshot {
//   src: string
//   sizes?: string
//   type?: string
//   label?: string
//   platform?: string
// }

interface CoverResult {
  // wam: WamScreenshot[]
  publication: LinkedResource[]
  html: string[]
  files: string[]
}

/**
 * Takes multiple screenshots of cover (index) page of the book
 */
async function generateCover(
  url: string,
  options: CoverGenerationOptions,
  pathDir: string,
  page: Page,
  debug = false
): Promise<CoverResult> {
  const result: CoverResult = {
    // wam: [],
    publication: [],
    html: [],
    files: [],
  }
  const sizes = options.covers.map((c) =>
    typeof c === 'string' ? coverSizes.find((s) => s.name === c) : c
  )
  if (!isSizes<CoverSize>(sizes))
    throw new Error('Covers option contains cover name that is not allowed.')
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  for (let i = 0; i < sizes.length; i++) {
    const { width, height, name } = sizes[i]
    await page.setViewportSize({
      width: width,
      height: height,
    })
    const filename = `cover-${width}x${height}.png`
    const url = '/' + options.assetDir + '/' + filename
    const filepath = pathDir + '/' + filename
    await page.screenshot({
      path: filepath,
      scale: 'css',
    })
    result.publication.push({
      type: 'LinkedResource',
      encodingFormat: 'image/png',
      rel: 'cover',
      name,
      url,
    })
    // result.wam.push({
    //   src: coverfile,
    //   type: 'image/png',
    //   sizes: `${width}x${height}`,
    // })
    result.files.push(filepath)
    if (!options.disableOgMetaGeneration && name === Cover.FACEBOOK) {
      result.html.push(`<meta property="og:image" content="${url}" />`)
    }
    if (!options.disableTwitterMetaGeneration && name === Cover.TWITTER) {
      result.html.push(`<meta property="twitter:image" content="${url}" />`)
    }
    if (debug) console.log(name, 'written')
  }
  return result
}

interface htmlProps {
  backgroundColor?: string
  titleColor?: string
  gridIcon: string
  author: string
  originalHead: string
}

export const getIconHtml = (props: htmlProps) => `
  <html>
  <head>
    ${props.originalHead}
    <style>
      .border {
        width: fit-content;
        height: fit-content;
        position: relative;
        padding: 38px;
      }
      #grid-overlay {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 2;
        background-image: url('data:image/svg+xml; utf8, ${props.gridIcon}');
        background-repeat: no-repeat;
        background-size: contain;
      }
      .canvas {
        height: 1024px;
        width: 1024px;
        display: flex;
        padding: 140px;
        justify-content: center;
        align-items: center;
        color: ${props.titleColor ? props.titleColor : 'var(--background)'};
        background: ${
          props.backgroundColor ? props.backgroundColor : 'var(--accent-color)'
        };
        font-family: sans-serif;
        box-sizing: border-box; 
      }
      .title-long {
        font-size: 120px;
        line-height: 1;
        hyphens: auto;
        overflow-wrap: break-word;
      }
      .title-short {
        font-size: 420px;
        hyphens: auto;
        overflow-wrap: break-word;
      }
    </style>
  </head>
  <body class="nb-role-cover nb-custom-style">
    <div class="border">
      <main>
        <div class="canvas canvas-icon icon" id="book-generator-icon">
          <h1 class="title title-short">${authorShort(props.author)}</h1>
        </div>
      </main>
      <div style="display:none;" id="grid-overlay"></div>
    </div>
    <button onClick="toggleOverlay()">show/hide overlay</button>
  </body>
  <script>
    function toggleOverlay() {
      var x = document.getElementById("grid-overlay");
      if (x.style.display === "none") {
        x.style.display = "block";
      } else {
        x.style.display = "none";
      }
    }
  </script>
</html>
`

async function getIconColors(
  covers: CoverResult,
  disableIconColorDetection: boolean,
  themeColor?: string
): Promise<IconColors> {
  const colors: IconColors = {}
  if (!themeColor && !disableIconColorDetection && covers.files.length > 0) {
    // to detect color from image, we are using sharp as its a shared dependency with favicons generation
    // extracting dominant color is now an experimental feature of sharp
    // discussed issue: https://github.com/lovell/sharp/issues/640
    // api reference: https://github.com/lovell/sharp/blob/c42de19d2acc8fb29cff0e18a81421fb05e71e1b/docs/api-input.md
    //
    // node-vibrant package was tested and may be used as well to extract the color palette from picture
    // and calculating its approx grayscale degree using YIQ color scheme formula
    // the formula: https://support.ptc.com/help/mathcad/en/index.html#page/PTC_Mathcad_Help/example_grayscale_and_color_in_images.html
    // node-vibrant example: https://codepen.io/kopol/pen/QWjwrPN
    const { dominant } = await sharp(covers.files[0]).stats()
    const dColor = Color(dominant)
    colors.background = dColor.hex()
    colors.title = dColor.isDark() ? '#fff' : '#000'
    if (DEBUG)
      console.log('icon colors detected from cover photo:', covers.files[0])
  }
  if (!colors.background && themeColor) {
    let color = Color(themeColor)
    colors.background = themeColor
    colors.title = color.isDark() ? '#fff' : '#000'
    if (DEBUG) console.log('icon colors derived from themeColor')
  }
  if (DEBUG && !colors.background) console.log('icon colors respect book css')
  return colors
}

async function writeFavicons(
  images: FaviconResponse['images'],
  assetDir: string
) {
  // images are Array of
  // { name: string, contents: <buffer> | { info: sharp info obj, data: <buffer> } }
  let img
  for (let i = 0; i < images.length; i++) {
    img = images[i]
    await fs.writeFile(
      assetDir + '/' + img.name,
      Buffer.isBuffer(img.contents) ? img.contents : img.contents.data
    )
  }
  if (DEBUG) console.log('icons written')
}

async function writeIconFiles(
  files: FaviconResponse['files'],
  assetsPath: string,
  denylist: string[]
) {
  const filtered = files.filter((f) => !denylist.includes(f.name))
  let file
  for (let i = 0; i < filtered.length; i++) {
    file = filtered[i]
    await fs.writeFile(assetsPath + '/' + file.name, file.contents)
    if (DEBUG) console.log(file.name, 'written')
  }
}

function getMetaHtml(options: CoverGenerationOptions, meta: Meta) {
  const html: string[] = []
  if (!options.disableOgMetaGeneration) {
    html.push(`<meta property="og:title" content="${meta.title}" />`)
    html.push(`<meta property="og:type" content="book" />`)
    html.push(`<meta property="og:book:author" content="${meta.author}" />`)
    if (options.description)
      html.push(
        `<meta property="og:description" content="${options.description}" />`
      )
  }
  if (!options.disableTwitterMetaGeneration) {
    html.push(`<meta property="twitter:title" content="${options.name}" />`)
    if (options.description)
      html.push(
        `<meta property="twitter:description" content="${options.description}" />`
      )
  }
  return html
}

async function insertToHeads(
  srcDir: string,
  faviconsHtml: FaviconResponse['html'],
  otherHtml: string[],
  denylist: string[]
) {
  const html = faviconsHtml
    .filter((element) => !denylist.some((file) => element.includes(file)))
    .concat(otherHtml)
  let files
  try {
    files = await fs.readdir(srcDir, 'utf8')
  } catch (e) {
    throw new Error('Reading source directory failed.')
  }
  const htmls = files.filter((file) => path.extname(file) == '.html')
  for (let i = 0; i < htmls.length; i++) {
    const file = srcDir + '/' + htmls[i]
    const data = await fs.readFile(file, 'utf8')
    const sep = '</head>'
    const parts = data.split(sep, 2)
    parts.splice(1, 0, '  ' + html.join('\n    '), '    \n' + sep)
    await fs.writeFile(file, parts.join(''))
  }
}

async function main(srcDir: string) {
  const configPath = path.join(srcDir, 'book.json')
  const config: Partial<Config> = JSON.parse(
    await fs.readFile(configPath, 'utf8')
  )
  const options = { ...defaultOptions, ...config.coverGenerationOptions }
  if (options.disableImageGeneration) return
  const meta = { ...defaultMeta, ...config.meta }
  if (!options.name) options.name = meta.author + ': ' + meta.title
  if (!options.shortName) options.shortName = meta.title
  const assetPath = path.join(srcDir, options.assetDir)
  const server = http.createServer(async function (req, res) {
    if (!req.url) return
    try {
      const data = await fs.readFile(path.join(process.cwd(), srcDir, req.url))
      res.writeHead(200)
      res.end(data)
    } catch (error) {
      res.writeHead(404)
      res.end(JSON.stringify(error))
      return
    }
  })
  server.listen(port, hostname)
  if (DEBUG)
    console.log(
      `running in DEBUG mode`,
      `\nstatic server is running until exited. go to ${hostname}:${port}/index.html`
    )
  const browser = await chromium.launch({ devtools: DEVTOOLS })
  const page = await browser.newPage()
  // generate cover
  let covers: CoverResult = { publication: [], html: [], files: [] }
  if (!options.disableCoverGeneration)
    covers = await generateCover(
      `${hostname}:${port}/index.html`,
      options,
      assetPath,
      page
    )
  // get colors
  const iconColors = await getIconColors(
    covers,
    options.disableIconsGeneration,
    options.themeColor
  )
  // generate icons
  const denylist = [
    options.disableBrowserConfigGeneration && 'browserconfig.xml',
    options.disableManifestGeneration && 'manifest.webmanifest',
  ].filter(Boolean) as string[]
  let faviconsHtml: string[] = []
  if (!options.disableIconsGeneration) {
    let sourceIconPath
    // generate icon if not provided
    if (!options.sourceIcon)
      sourceIconPath = await generateIcon(
        srcDir,
        meta.author,
        assetPath,
        page,
        iconColors
      )
    else sourceIconPath = path.join(srcDir, options.sourceIcon)
    if (DEBUG) console.log('loaded source icon:', sourceIconPath)
    const faviconsResponse = await favicons(sourceIconPath, {
      path: options.assetDir,
      background: iconColors.background,
      theme_color: options.themeColor,
      icons: options.icons,
      appName: options.name,
      appShortName: options.shortName,
      appDescription: options.description,
    })
    await writeFavicons(faviconsResponse.images, assetPath)
    if (DEBUG) console.log('excluded files:', denylist.join(','))
    await writeIconFiles(faviconsResponse.files, assetPath, denylist)
    faviconsHtml = faviconsResponse.html
  }
  // html
  const html = getMetaHtml(options, meta).concat(covers.html)
  await insertToHeads(srcDir, faviconsHtml, html, denylist)
  if (DEBUG) return
  await browser.close()
  server.close()
  process.exit()
}

export default main