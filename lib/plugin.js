'use strict';
const path = require('path');
const url = require('url');
const fs = require('fs');
const UglifyJS = require('uglify-es');
const util = require('util');
const md5 = require('md5');
const format = util.format;
const swPrecache = require('sw-precache');
const merge = require('webpack-merge');
const utils = require('./utils');
const ManifestServiceWorker = require('./manifest');

const FILEPATH_WARNING = 'service-worker-precache-webpack-plugin [filepath]: You are using a custom path for your service worker, this may prevent the service worker from working correctly if it is not available in the same path as your application.';
const FORCEDELETE_WARNING = 'service-worker-precache-webpack-plugin [forceDelete]: You are specifying the option forceDelete. This was removed in v0.10. It should not affect your build but should no longer be required.';

const
  DEFAULT_CACHE_ID = 'service-worker-precache-webpack-plugin',
  DEFAULT_WORKER_FILENAME = 'service-worker.js',
  DEFAULT_PUBLIC_PATH = '',
  DEFAULT_IMPORT_SCRIPTS = [],
  DEFAULT_IGNORE_PATTERNS = [],
  CHUNK_NAME_NOT_FOUND_ERROR = 'Could not locate files for chunkName: "%s"',
  // eslint-disable-next-line max-len
  CHUNK_NAME_OVERRIDES_FILENAME_WARNING = 'Don\'t use chunkName & filename together; importScripts[<index>].filename overriden by specified chunkName: %j';

const DEFAULT_OPTIONS = {
  prefix: 'sw',
  cacheId: DEFAULT_CACHE_ID,
  filename: DEFAULT_WORKER_FILENAME,
  importScripts: DEFAULT_IMPORT_SCRIPTS,
  staticFileGlobsIgnorePatterns: DEFAULT_IGNORE_PATTERNS,
  mergeStaticsConfig: false,
  minify: false,
  hash: false,
  hashLength: 8,
  inlineServiceWorkerManifestTag: 'SERVICE_WORKER_MANIFEST',
  runtimeCachingItemOption: {
    handler:  'cacheFirst'
  }
};

class ServiceWorkerWebpackPlugin {

  /**
   * ServiceWorkerWebpackPlugin - A wrapper for sw-precache to use with webpack
   * @constructor
   * @param {object} options - All parameters should be passed as a single options object. All sw-precache options can be passed here in addition to plugin options.
   *
   * // plugin options:
   * @param {string} [options.filename] - Service worker filename, default is 'service-worker.js'
   * @param {string} [options.filepath] - Service worker path and name, default is to use webpack.output.path + options.filename
   * @param {RegExp} [options.staticFileGlobsIgnorePatterns[]] - Define an optional array of regex patterns to filter out of staticFileGlobs
   * @param {boolean} [options.mergeStaticsConfig=false] - Merge provided staticFileGlobs and stripPrefix(Multi) with webpack's config, rather than having those take precedence
   * @param {boolean} [options.minify=false] - Minify the generated Service worker file using UglifyJS
   * @param {boolean} [options.debug=false] - Output error and warning messages
   */
  constructor(options) {
    // generated configuration options
    this.config = {};
    // configuration options passed by user
    this.options = merge(DEFAULT_OPTIONS, options);
    // push warning messages here
    this.warnings = [];
  }

  apply(compiler) {
    // sw-precache needs physical files to reference so we MUST wait until after assets are emitted before generating the service-worker.
    compiler.plugin('after-emit', (compilation, callback) => {
      // create service worker by webpack manifest
      const baseDir = compiler.options.context || process.cwd();
      const outputPath = compiler.outputPath;
      const publicPath = compiler.options.output.publicPath;
      const localPublicPath = this.options.localPublicPath || publicPath;
      const swManifestFileName = this.options.prefix ? [this.options.prefix, 'mapping.json'].join('-') : 'mapping.json';
      const swManifestFilePath = path.resolve(outputPath, swManifestFileName);
      const importScripts = this.configureImportScripts(this.options.importScripts, publicPath, compiler, compilation);
      
      this.options = merge(this.options, { importScripts });
      
      if (!this.options.manifest) {
        const manifestConfigFile = path.resolve(baseDir, 'config/manifest.json');
        if(fs.existsSync(manifestConfigFile)) {
          this.options.manifest = require(manifestConfigFile);
        } else {
          this.options.strategy = 'single';
          this.options.manifest = Object.keys(compilation.assets).concat(this.options.staticFileGlobs || []).map( f => {
            if(utils.isHttpOrHttps(publicPath)) {
              return publicPath + f;
            } else {
              return path.join(outputPath, f);
            }
          });
        }
      }

      const manifestServiceWorker = new ManifestServiceWorker(compiler, this.options);
      const workerOptionsList = manifestServiceWorker.createServiceWorkerOptions();
      const promises = workerOptionsList.map((workerOptions, index) => {
        return this.createServiceWorkerFile(compiler, workerOptions);
      });

      // create service worker manifest file
      const swManifest = {
        config: { 
          fullPublicPath: publicPath,
          publicPath: localPublicPath,
          outputPath: outputPath.replace(`${baseDir}/`, '')
        }
      };

      if (this.options.strategy !== undefined && this.options.strategy !== 'single') {
        swManifest.config.prefix = this.options.prefix;
      }

      Promise.all(promises).then(result => {
        result.forEach(item => {
          swManifest[item.source] = item.target;
        });
        const inlineServiceWorkerManifestTag = this.options.inlineServiceWorkerManifestTag;
        if(typeof inlineServiceWorkerManifestTag === 'string') {
          compilation.chunks.forEach(chunk => {
            chunk.files.forEach(filename => {
              if(/\.js/.test(filename)) {
                const filepath = path.join(outputPath, filename);
                const source = compilation.assets[filename].source();
                const reg = new RegExp(inlineServiceWorkerManifestTag, 'gm');
                if (reg.test(source)) {
                  const newSource = source.replace(reg, JSON.stringify(swManifest, null, 2));
                  this.writeCompilerFile(compiler, filepath, newSource);
                }
              }
            });
          });
        }
        this.writeCompilerFile(compiler, swManifestFilePath, swManifest);
        compilation.applyPluginsAsync('service-worker-webpack-plugin-after-emit', result, callback);
      }).catch(err => callback(err));
    });
  }

  configureImportScripts(importScripts, publicPath, compiler, compilation) {
    if (!importScripts) {
      return [];
    }

    const {hash, chunks} = compilation.getStats()
      .toJson({hash: true, chunks: true});

    return importScripts
      .reduce((fileList, criteria) => {
        // legacy support for importScripts items defined as string
        if (typeof criteria === 'string') {
          criteria = {filename: criteria};
        }

        const hasFileName = !!criteria.filename;
        const hasChunkName = !!criteria.chunkName;

        if (hasFileName && hasChunkName) {
          this.warnings.push(new Error(
            format(CHUNK_NAME_OVERRIDES_FILENAME_WARNING, criteria)
          ));
        }

        if (hasChunkName) {
          const chunk = chunks.find(c => c.names.includes(criteria.chunkName));

          if (!chunk) {
            compilation.errors.push(new Error(
              format(CHUNK_NAME_NOT_FOUND_ERROR, criteria.chunkName)
            ));
            return fileList;
          }

          const chunkFileName = chunk.files[chunk.names.indexOf(criteria.chunkName)];
          fileList.push(url.resolve(publicPath, chunkFileName));
        } else if (hasFileName) {
          const hashedFilename = criteria.filename.replace(/\[hash\]/g, hash);
          fileList.push(url.resolve(publicPath, hashedFilename));
        }
        return fileList;
      }, []);
  }

  createServiceWorkerFile(compiler, workerOptions) {
    // generate service worker then write to file system
    return this.createServiceWorker(compiler, workerOptions)
      .then(serviceWorker => this.writeServiceWorker(serviceWorker, compiler, workerOptions));
  }

  createServiceWorker(compiler, workerOptions) {
    return swPrecache.generate(workerOptions)
      .then((serviceWorkerFileContents) => {
        if (this.options.minify) {
          const uglifyFiles = {};
          uglifyFiles[this.options.filename] = serviceWorkerFileContents;
          return UglifyJS.minify(uglifyFiles).code;
        }
        return serviceWorkerFileContents;
      });
  }

  writeCompilerFile(compiler, filepath, json) {
    const { outputFileSystem } = compiler;
    outputFileSystem.mkdirp(path.resolve(filepath, '..'), e => {
      if (e) {
        console.error('create file dir error', filepath, e);
        return;
      }
      const content = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
      outputFileSystem.writeFile(filepath, content, e => {
        if (e) {
          console.error('create file error', filepath, e);
        }
      });
    });
  }

  writeServiceWorker(serviceWorker, compiler, workerOptions) {
    const {filepath} = workerOptions;
    const {outputFileSystem} = compiler;

    // use the outputFileSystem api to manually write service workers rather than adding to the compilation assets
    return new Promise((resolve, reject) => {
      outputFileSystem.mkdirp(path.resolve(filepath, '..'), (mkdirErr) => {
        if (mkdirErr) {
          reject(mkdirErr);
          return;
        }
        const ext = 'js';
        const dirname = path.dirname(filepath);
        const filename = path.basename(filepath, `.${ext}`);
        const hash = this.options.hash ? md5(filename + serviceWorker).slice(0, this.options.hashLength) : '';
        const sourceFilename = [filename, ext].join('.');
        const targetFilename = hash ?  [filename, hash, ext].join('.') : sourceFilename;
        const targetFilepath = [ dirname, targetFilename].join(path.sep); 
        outputFileSystem.writeFile(targetFilepath, serviceWorker, writeError => {
          if (writeError) {
            reject(writeError);
          } else {
            resolve({ source: sourceFilename, target: targetFilename, content: serviceWorker });
          }
        });
      });
    });
  }

  /**
   * Push plugin warnings to webpack log
   * @param {object} compilation - webpack compilation
   * @returns {void}
   */
  checkWarnings(compilation) {
    if (this.options.filepath) {
      // warn about changing filepath
      this.warnings.push(new Error(FILEPATH_WARNING));
    }

    if (this.options.forceDelete) {
      // deprecate forceDelete
      this.warnings.push(new Error(FORCEDELETE_WARNING));
    }

    if (this.workerOptions.debug) {
      this.warnings.forEach(warning => compilation.warnings.push(warning));
    }
  }
}


module.exports = ServiceWorkerWebpackPlugin;