'use strict';

const utils ={

};

utils.isHttpOrHttps = (url) => {
  return /^(https?:|\/\/)/.test(url);
};

module.exports = utils;