'use strict';
const path = require('path');
const url = require('url');
const fs = require('fs');
const UglifyJS = require('uglify-es');
const util = require('util');
const md5 = require("md5");
const format = util.format;
const swPrecache = require('sw-precache');
const ManifestServiceWorker = require('./manifest');

const FILEPATH_WARNING = 'service-worker-webpack-plugin [filepath]: You are using a custom path for your service worker, this may prevent the service worker from working correctly if it is not available in the same path as your application.';
const FORCEDELETE_WARNING = 'service-worker-webpack-plugin [forceDelete]: You are specifying the option forceDelete. This was removed in v0.10. It should not affect your build but should no longer be required.';

const
  DEFAULT_CACHE_ID = 'service-worker-webpack-plugin',
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
  hashLength: 8
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
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    // generated configuration that will override user options
    this.overrides = {};
    // push warning messages here
    this.warnings = [];
  }

  /**
   * @returns {object} - plugin configuration
   */
  get workerOptions() {
    return {
      ...this.config,
      ...this.options,
      ...this.overrides,
    };
  }

  apply(compiler) {
    // sw-precache needs physical files to reference so we MUST wait until after assets are emitted before generating the service-worker.
    compiler.plugin('after-emit', (compilation, callback) => {
      // create service worker by webpack manifest
      if(this.options.manifest) {
        const {outputPath} = compiler;
        const { publicPath = DEFAULT_PUBLIC_PATH } = compiler.options.output;
        const manifestServiceWorker = new ManifestServiceWorker(compiler, this.options);
        const workerOptionsList = manifestServiceWorker.createServiceWorkerOptions();
        const promises = workerOptionsList.map((workerOptions, index) =>{
          return this.createServiceWorkerFile(compiler, workerOptions);
        });
        // create service worker manifest file
        const serviceWorkerManifest = {
          config: {
            prefix: this.options.prefix,
            publicPath: manifestServiceWorker.publicPath
          }
        };
        Promise.all(promises).then(result =>{
          result.forEach(item => {
            serviceWorkerManifest[item.source] = manifestServiceWorker.publicPath + item.target;
          });
          const filepath = path.resolve(outputPath, [this.options.prefix, 'manifest.json'].join('-'));
          this.writeServiceWorkerManifest(compiler, filepath, serviceWorkerManifest);
          compilation.applyPluginsAsync('service-worker-webpack-plugin-after-emit', result, callback);
        }).catch(err => callback(err));
      } else {
        this.configure(compiler, compilation); 
        this.checkWarnings(compilation);
        this.createServiceWorkerFile(compiler, this.workerOptions)
        .then(result => {
          callback();
        })
        .catch(err => callback(err));;
      }
    });
  }

  configure(compiler, compilation) {

    // get the defaults from options
    const {
        importScripts,
        staticFileGlobsIgnorePatterns,
        mergeStaticsConfig,
        stripPrefixMulti = {},
      } = this.options;

    // get the output path used by webpack
    const {outputPath} = compiler;
  
    // outputPath + filename or the user option
    const {filepath = path.resolve(outputPath, this.options.filename)} = this.options;
    // get the public path specified in webpack config
    const {publicPath = DEFAULT_PUBLIC_PATH} = compiler.options.output;
    // get all assets outputted by manifest or webpack
    const assetGlobs = Object.keys(compilation.assets).map(f => path.join(outputPath, f));
    // merge assetGlobs with provided staticFileGlobs and filter using staticFileGlobsIgnorePatterns
    const staticFileGlobs = assetGlobs.concat(this.options.staticFileGlobs || []).filter(text =>
      (!staticFileGlobsIgnorePatterns.some((regex) => regex.test(text)))
    );
  
    if (outputPath) {
      // strip the webpack config's output.path (replace for windows users)
      stripPrefixMulti[`${outputPath}${path.sep}`.replace(/\\/g, '/')] = publicPath;
    }

    if(this.options.prefix) {
      this.options.cacheId = this.options.prefix + '-' + this.options.cacheId;
    }

    this.config = {
      ...this.config,
      staticFileGlobs,
      stripPrefixMulti,
    };
    // set the actual filepath
    this.overrides.filepath = filepath;

    // resolve [hash] used in importScripts
    this.configureImportScripts(importScripts, publicPath, compiler, compilation);

    if (mergeStaticsConfig) {
      // merge generated and user provided options
      this.overrides = {
        ...this.overrides,
        staticFileGlobs,
        stripPrefixMulti,
      };
    }
  }

  configureImportScripts(importScripts, publicPath, compiler, compilation) {
    if (!importScripts) {
      return;
    }

    const {hash, chunks} = compilation.getStats()
      .toJson({hash: true, chunks: true});

    this.overrides.importScripts = importScripts
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

  writeServiceWorkerManifest(compiler, filepath, manifest) {
    const { outputFileSystem } = compiler;
    outputFileSystem.mkdirp(path.resolve(filepath, '..'), e => {
      if (e) {
        console.error('create manifest dir error', filepath, e);
        return;
      }
      outputFileSystem.writeFile(filepath, JSON.stringify(manifest, null, 2), e => {
          if (e) {
            console.error('create manifest file error', filepath, e);
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
