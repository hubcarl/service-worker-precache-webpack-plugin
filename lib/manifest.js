'use strict';
const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp');
const merge = require('webpack-merge');
module.exports = class ManifestServiceWorker {
  constructor(compiler, options) {
    this.compiler = compiler;
    this.options = options;
    this.baseDir = compiler.options.context || process.cwd();
    this.outputPath = compiler.outputPath;
    this.strategy = this.options.strategy || 'single';
    this.prefix = this.options.prefix;
    this.manifest = this.normalizeManifest(this.options.manifest, this.baseDir);
    this.publicPath = this.manifest.info.publicPath;
    this.stripPrefixMulti = {};
    this.stripPrefixMulti[`${this.outputPath}${path.sep}`.replace(/\\/g, '/')] = this.publicPath;
  }

  createSingleServiceWorker() {
    const option = {
      stripPrefixMulti: this.stripPrefixMulti,
      staticFileGlobs: [],
      runtimeCaching: []
    };
    if (!this.options.filepath) {
      option.filepath = path.resolve(this.outputPath, this.options.filename);
    }
    Object.keys(this.manifest).forEach(entryName => {
      const url = this.manifest[entryName];
      if (typeof url === 'string') {
        if (this.isHttpOrHttps(url)) {
          option.runtimeCaching.push({
            urlPattern: new RegExp(url),
            handler: 'fastest'
          });
        } else if(this.isCacheStaticFile(url)) {
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
        const filename = this.prefix + '-' + entryName.replace(/\//g, '-');
        const filepath = path.resolve(this.outputPath, filename);
        const fileOption = this.normalizeServiceWorkerFileOption(res);
        const staticFileGlobs = Array.from(new Set(fileOption.staticFileGlobs));
        const runtimeCaching = Array.from(new Set(fileOption.runtimeCaching)).map(url => {
          return {
            urlPattern: new RegExp(url),
            handler: 'fastest'
          }
        });
        const option = merge(this.options, {filepath}, {
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
        const filename = this.prefix + '-' + (/\.js$/.test(config.name) ? config.name : config.name + '.js');
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
          return {
            urlPattern: new RegExp(url),
            handler: 'fastest'
          }
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
    return Array.isArray(options) ? options : options ? [options] : [];
  }

  isHttpOrHttps(url) {
    return /^(https?:|\/\/)/.test(url);
  }

  normalizeServiceWorkerFileOption(res) {
    const options = {
      staticFileGlobs: [],
      runtimeCaching: []
    };
    [...res.css, ...res.js].forEach(url => {
      if (this.isHttpOrHttps(url)) {
        options.runtimeCaching.push(url);
      } else {
        if(this.isCacheStaticFile(url)) {
          const filepath = path.resolve(this.outputPath, url.replace(this.publicPath, ''));
          options.staticFileGlobs.push(filepath);
        }
      }
    });
    return options;
  }

  isCacheStaticFile(url){
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
    if (this.isHttpOrHttps(publicPath)) {
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

  createServiceWorkerManifest (filepath, content) {
    try {
      mkdirp.sync(path.dirname(filepath));
      fs.writeFileSync(filepath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
    } catch (e) {
      console.error(`writeFile ${filepath} err`, e);
    }
  };

}