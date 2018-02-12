# service-worker-precache-webpack-plugin

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![Test coverage][codecov-image]][codecov-url]
[![David deps][david-image]][david-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/service-worker-precache-webpack-plugin.svg?style=flat-square
[npm-url]: https://npmjs.org/package/service-worker-precache-webpack-plugin
[travis-image]: https://img.shields.io/travis/hubcarl/service-worker-precache-webpack-plugin.svg?style=flat-square
[travis-url]: https://travis-ci.org/hubcarl/service-worker-precache-webpack-plugin
[codecov-image]: https://codecov.io/gh/hubcarl/service-worker-precache-webpack-plugin/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/hubcarl/service-worker-precache-webpack-plugin
[david-image]: https://img.shields.io/david/hubcarl/service-worker-precache-webpack-plugin.svg?style=flat-square
[david-url]: https://david-dm.org/hubcarl/service-worker-precache-webpack-plugin
[snyk-image]: https://snyk.io/test/npm/service-worker-precache-webpack-plugin/badge.svg?style=flat-square
[snyk-url]: https://snyk.io/test/npm/service-worker-precache-webpack-plugin
[download-image]: https://img.shields.io/npm/dm/service-worker-precache-webpack-plugin.svg?style=flat-square
[download-url]: https://npmjs.org/package/service-worker-precache-webpack-plugin

create service worker javascript file and manifest by webpack manifest and sw-precache, you can use with [service-worker-register](https://github.com/hubcarl/service-worker-register)

- compatible [sw-precache-webpack-plugin](https://github.com/goldhand/sw-precache-webpack-plugin) plugin functionality
- support create service worker javascript file by webpack manifest [webpack-manifest-resource-plugin](https://github.com/hubcarl/webpack-manifest-resource-plugin)
- inject service worker manifest file content to global var `SERVICE_WORKER_MANIFEST` 
- create service worker manifest file `sw-mapping.json`

## Install

```bash
npm i service-worker-precache-webpack-plugin --save-dev
```

## Usage

### create `sw-precache-webpack-plugin` service worker file

```js
const ServiceWorkerWebpackPlugin = require('service-worker-precache-webpack-plugin');
module.exports = {
  plugins:[
    new ServiceWorkerWebpackPlugin({
        cacheId: 'my-project-name',
        dontCacheBustUrlsMatching: /\.\w{8}\./,
        filename: 'service-worker.js',
        minify: true,
        navigateFallback: PUBLIC_PATH + 'index.html',
        staticFileGlobsIgnorePatterns: [/\.map$/, /sw-manifest\.json$/],
    })
  ]  
}
```
more configuration [sw-precache-webpack-plugin](https://github.com/goldhand/sw-precache-webpack-plugin)

### create `sw-precache-webpack-plugin` service worker file by webpack manifest

#### create service worker file based on the specified webpack entry

```js
module.exports = {
  plugins: [
    new ServiceWorkerWebpackPlugin({
      prefix: 'sw',
      strategy: [
        {
          name: 'index',
          entry: 'index/index',
        },
        {
          name: 'category',
          entry: ['category/category', 'about/about'],
          options: {
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/category\.com\/api/,
                handler: 'fastest'
              }
            ]
          }
        }
      ],
      manifest: 'config/manifest.json'
    }
  ]
}
```

### support create an independent service worker file for webpack each entry

```js
module.exports = {
    plugins:[
        new ServiceWorkerWebpackPlugin({
            prefix: 'sw',
            strategy: 'multiple'
        }
    ] 
}
```


## Configuration

- compatible [sw-precache-webpack-plugin](https://github.com/goldhand/sw-precache-webpack-plugin) configuration


## Extended Configuration 

```js
new ServiceWorkerWebpackPlugin(option);
```

- `option.prefix` : {String}, optional - Service worker file prefix, default: `sw`. such as:

```js
new ServiceWorkerWebpackPlugin({
    prefix: 'sw',
    filename: 'home.js'
});
```
The final generated file is `sw-home.js`


- `option.manifest` {Object}, optional - The format is [webpack-manifest-resource-plugin](https://github.com/hubcarl/webpack-manifest-resource-plugin). when create service worker by webpack manifest, you must set this config. if `config/manifest.json` exists, will use this manifest config.

- `option.strategy` {String|Array} - How to create service worker file by what strategy. The value optional : `single`, `multiple`, and Array config. default: `single`

```
single: create a service worker file by all webpack entry
multiple: create an independent service worker file for webpack each entry
array type: if the value is array, create service worker file based on the specified webpack entry
```

```js
{
  strategy: [
    {
        name: 'index',
        entry: 'index/index',
    },
    {
        name: 'category',
        entry: ['category/category', 'about/about'],
        options: {
        runtimeCaching: [
            {
             urlPattern: /^https:\/\/category\.com\/api/,
             handler: 'fastest'
            }
        ]
      }
    }
 ]
}
```
the option.strategy[] array item config:

- `name`: {String} - service worker file name.
- `entry`: {String|Array} - the webpack entry name.
- `options`: {Object}, optional - the `sw-precache-webpack-plugin` option.

## Manifest

- The plugin will create service worker manifest file, solve the service worker cache problem by manifest.

```
// sw-manifest.js
{
  "config": {
    "localPublicPath": "/public/",
    "publicPath": "/public/"
  },
  "service-worker.js": "/public/service-worker.567ddfd3.js"
}
```

- use with [service-worker-register](https://github.com/hubcarl/service-worker-register)

```js
const serviceWorkerRegister = require('service-worker-register');
// The service-worker.js name will get really url address by sw-mapping.json file
serviceWorkerRegister.register('service-worker.js');
```

## Relation

 fork [sw-precache-webpack-plugin](https://github.com/goldhand/sw-precache-webpack-plugin)

## License

[MIT](LICENSE)
