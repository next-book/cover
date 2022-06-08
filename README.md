# cover 

no config besides standard book.json needed

might be run using ts-node
```
src/ts-node-bin.ts ../boilerplate/_temp
```

or eventually as specified in package.json bin property 

book config description and defaults:

```js
{
  meta: {
    title: string, // defaults to  "No Title",
    author: string // defaults to "No Author",
  },
  coverGenerationOptions?: {
    disableImageGeneration: false, // the app does nothing when set to true
    disableCoverGeneration: false, // skips cover generation, and disables color detection in icon generation  
    covers: [ // list of allowed cover names, default is below 
      "amazon", // recommended amazon e-book size
      "facebook", // open graph - also generates related meta tags
      "twitter", // tweet image - also generates related meta tags
      "mkp" // standard mkp size
    ],
    disableIconsGeneration: false, // completely skips any icon generation, leaving only covers
    disableIconColorDetection: false, // forces using book css to generate icon when themeColor not set 
    sourceIcon?: string, // path to icon, might be png, svg...
    themeColor?: string, // when set, used as icon background 
    name?: string, // app name used in meta and manifest, defaults to book meta title
    shortName?: string, // similar
    description?: string, // similar 
    icons: { // supported platforms dict, allows specifying icon generation sizes and ratios by providing more comprehensive objects
      android: true,
      appleIcon: true,
      appleStartup: false,
      favicons: true,
      windows: false,
      yandex: false
    },
    assetDir: string, // allows to specify asset directory name, default to "assets" 
    disableOgMetaGeneration: false, // disables generating facebook og meta tags
    disableTwitterMetaGeneration: false, // disables generating tw meta tags
    disableManifestGeneration: false, // disables web app manifest file and meta generation 
    disableBrowserConfigGeneration: true, // disables browserconfig.xml file and meta generation
    startUrl?: string // web app startup url, default to '/'
 }
}
```
