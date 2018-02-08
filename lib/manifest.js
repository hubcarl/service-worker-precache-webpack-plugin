'use strict';
const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp');
const merge = require('webpack-merge');
const utils = require('./utils');
module.exports = class ManifestServiceWorker {
  constructor(compiler, options) {
    this.compiler = compiler;
    this.options = options;
    this.baseDir = compiler.options.context || process.cwd();
    this.outputPath = compiler.outputPath;
    this.strategy = this.options.strategy || 'single';
    this.prefix = this.options.prefix;
    this.manifest = this.normalizeManifest(this.options.manifest, this.baseDir);
    this.publicPath = this.options.localPublicPath || compiler.options.output.publicPath;
    this.stripPrefixMulti = {};
    this.stripPrefixMulti[`${this.outputPath}${path.sep}`.replace(/\\/g, '/')] = this.publicPath;
  }

  createSingleServiceWorker() {
    const option = {
      prefix: '',
      stripPrefixMulti: this.stripPrefixMulti,
      staticFileGlobs: [],
      runtimeCaching: []
    };
    if (!this.options.filepath) {
      option.filepath = path.resolve(this.outputPath, this.options.filename);
    }
    Object.keys(this.manifest).forEach(entryName => {
      const url = this.manifest[entryName];
      if (typeof url === 'string' && this.isCacheFile(url)) {
        if (utils.isHttpOrHttps(url)) {
          option.runtimeCaching.push(merge(this.options.runtimeCachingItemOption, {
            urlPattern: new RegExp(url)
          }));
        } else {
          option.staticFileGlobs.push(...this.normalizePath(url));
        }
      }
    });
    return merge(this.options, option);
  }

  createMultipleServiceWorker() {
    const options = [];
    const deps = this.manifest.deps;
    Object.keys(deps).forEach(entryName => {
      const res = deps[entryName] || {};
      if (!/^(js\/chunk|common\.js|vendor\.js)/.test(entryName)) {
        const filename = this.prefix ? this.prefix + '-' + entryName.replace(/\//g, '-') : entryName.replace(/\//g, '-');
        const filepath = path.resolve(this.outputPath, filename);
        const fileOption = this.normalizeServiceWorkerFileOption(res);
        const staticFileGlobs = Array.from(new Set(fileOption.staticFileGlobs));
        const runtimeCaching = Array.from(new Set(fileOption.runtimeCaching)).map(url => {
          return merge(this.options.runtimeCachingItemOption, {
            urlPattern: new RegExp(url)
          });
        });
        const option = merge(this.options, {
          filepath
        }, {
          staticFileGlobs,
          runtimeCaching,
          stripPrefixMulti: this.stripPrefixMulti
        });
        options.push(option);
      }
    });
    return options;
  }

  createConfigServiceWorker() {
    const options = [];
    if (Array.isArray(this.strategy)) {
      this.strategy.forEach(config => {
        const name = /\.js$/.test(config.name) ? config.name : config.name + '.js';
        const filename = this.prefix ? this.prefix + '-' + name : name;
        const filepath = path.resolve(this.outputPath, filename);
        const entry = Array.isArray(config.entry) ? config.entry : [config.entry];
        const staticFileGlobsList = [];
        const runtimeCachingList = []
        entry.forEach(item => {
          const entryName = /\.js/.test(item) ? item : `${item}.js`;
          const res = this.manifest.deps[entryName];
          const fileOption = this.normalizeServiceWorkerFileOption(res);
          staticFileGlobsList.push(...fileOption.staticFileGlobs);
          runtimeCachingList.push(...fileOption.runtimeCaching);
        });
        // remove repeat url
        const staticFileGlobs = Array.from(new Set(staticFileGlobsList));
        const runtimeCaching = Array.from(new Set(runtimeCachingList)).map(url => {
          return merge(this.options.runtimeCachingItemOption, {urlPattern: new RegExp(url)});
        });
        const option = merge(this.options, config.options, {
          filepath,
          staticFileGlobs,
          runtimeCaching,
          stripPrefixMulti: this.stripPrefixMulti
        });
        options.push(option);
      });
    }
    return options;
  }

  createServiceWorkerOptions() {
    let options;
    switch (this.strategy) {
      case 'single':
        options = this.createSingleServiceWorker();
        break;
      case 'multiple':
        options = this.createMultipleServiceWorker();
        break;
      default:
        options = this.createConfigServiceWorker();
        break;
    }
    options = Array.isArray(options) ? options : options ? [options] : [];
    options.forEach(option => {
      if (option.runtimeCaching && option.runtimeCaching.length === 0) {
        option.runtimeCaching = null;
      }
    });
    return options;
  }



  normalizeServiceWorkerFileOption(res) {
    const options = {
      staticFileGlobs: [],
      runtimeCaching: []
    };
    [...res.css, ...res.js].forEach(url => {
      if (this.isCacheFile(url)) {
        if (utils.isHttpOrHttps(url)) {
          options.runtimeCaching.push(url);
        } else {
          const filepath = path.resolve(this.outputPath, url.replace(this.publicPath, ''));
          options.staticFileGlobs.push(filepath);
        }
      }
    });
    return options;
  }

  isCacheFile(url) {
    return !this.options.staticFileGlobsIgnorePatterns.some(regex => regex.test(url));
  }
  normalizePath(files) {
    files = Array.isArray(files) ? files : [files];
    const result = files.map(file => {
      return path.resolve(this.outputPath, file.replace(this.publicPath, ''));
    });
    return result;
  }
  normalizePublicPath(publicPath) {
    if (utils.isHttpOrHttps(publicPath)) {
      const temp = publicPath.split('//')[1].split('/');
      temp.shift();
      return `/${temp.join('/')}`;
    }
    return publicPath;
  }

  normalizeManifest(manifest, baseDir) {
    if (typeof manifest === 'string') {
      const filepath = path.isAbsolute(manifest) ? manifest : path.resolve(baseDir, manifest);
      if (fs.existsSync(filepath)) {
        return require(filepath);
      }
      return null;
    }
    return manifest;
  }

  createServiceWorkerManifest(filepath, content) {
    try {
      mkdirp.sync(path.dirname(filepath));
      fs.writeFileSync(filepath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
    } catch (e) {
      console.error(`writeFile ${filepath} err`, e);
    }
  };

}