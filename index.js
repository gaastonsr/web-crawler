/* eslint-disable no-console */

const http = require('http');
const https = require('https');
const url = require('url');
const { Parser } = require('htmlparser2');

const MAX_RETRIES = 3;
const TIMEOUT_AFTER = 3000;
const MIN_WORD_LENGTH = 5;
const HTTP_MODULE = { http, https };

async function crawl(url, limit = 30, topNWords = 5) {
  let crawledPages = 0;
  let queue = [url];
  const frequencyByWord = {};
  const discoveredUrls = { [url]: true };

  while (queue.length > 0) {
    const url = queue[0];
    const shouldWeDownload = await canWeDownloadHtml(url);

    if (!shouldWeDownload) {
      console.log('Skipping', url);
      queue = queue.slice(1);
      continue;
    }

    console.log('Processing', url);
    const html = await downloadPage(url);
    const { urls, text } = parseHtml(html, url);

    // warning: this mutates frequencyByWord
    accumulateWordFrequency(frequencyByWord, text);

    if (++crawledPages >= limit) {
      queue = [];
    } else {
      const newUrls = urls.filter(url => {
        const result = !discoveredUrls[url];
        discoveredUrls[url] = true;
        return result;
      });

      queue = queue.slice(1).concat(newUrls);
    }
  }

  return getTopWords(frequencyByWord, topNWords);
}

function httpRequest(_url, method) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(_url);
    const options = Object.assign({ method, timeout: TIMEOUT_AFTER }, parsedUrl);
    const protocolWithoutColon = parsedUrl.protocol.slice(0, -1);

    const request = HTTP_MODULE[protocolWithoutColon]
      .request(options, response => {
        const body = [];
        response
          .on('data', chunk => body.push(chunk))
          .on('end', () => {
            response.bodyAsString = Buffer.concat(body).toString();
            resolve(response);
          });
      });

    request.on('error', reject);
    request.end();
  });
}

function wait(timeout) {
  return new Promise(resolve => setTimeout(resolve, timeout));
}

async function httpRequestWithRetries(url, method) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await httpRequest(url, method);
    } catch (error) {
      console.error(error.stack);
      const timeout = Math.pow(2, i) * 100;
      console.log('waiting', timeout, 'ms');
      await wait(timeout);
    }
  }

  throw new Error('Maximum number of retries reached');
}

async function downloadPage(url) {
  const response = await httpRequestWithRetries(url, 'GET');
  return response.bodyAsString;
}

async function canWeDownloadHtml(url) {
  const response = await httpRequestWithRetries(url, 'HEAD');
  return response.headers['content-type'].startsWith('text/html');
}

function parseHtml(html, url) {
  const urls = [];
  let text = '';
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === 'a' && isSameDomain(url, attributes.href)) {
        urls.push(buildFullUrl(url, attributes.href));
      }
    },
    ontext(moreText) {
      text += moreText.trim() + ' ';
    }
  });

  parser.write(html);
  parser.end();

  return { urls, text };
}

function isSameDomain(url1, url2 = '') {
  if (url2.startsWith('/')) { return true; }
  const urls = [url.parse(url1), url.parse(url2)];
  return ['protocol', 'host', 'port'].every(prop => urls[0][prop] === urls[1][prop]);
}

function buildFullUrl(originalUrl, urlToNormalize) {
  const parsedUrl = url.parse(urlToNormalize);
  const { protocol, origin, auth, host } = url.parse(originalUrl);
  return url.format({ protocol, origin, auth, host, pathname: parsedUrl.pathname });
}

function accumulateWordFrequency(initial, text) {
  return text.split(' ').reduce((accumulator, _word) => {
    const word = _word.trim();
    if (word === '' || word.length < MIN_WORD_LENGTH) { return accumulator; }
    if (!accumulator[word]) { accumulator[word] = 0; }
    accumulator[word] += 1;
    return accumulator;
  }, initial);
}

// use priority queue in real world application
function getTopWords(frequencyByWord, numberOfWords) {
  return Object
    .keys(frequencyByWord)
    .sort((a, b) => frequencyByWord[a] - frequencyByWord[b])
    .slice(-numberOfWords)
    .map(key => ({ word: key, frequency: frequencyByWord[key] }));
}

function isUrlValid(_url) {
  const parsedUrl = url.parse(_url);
  return ['protocol', 'host'].every(part => parsedUrl[part]);
}

process.on('unhandledRejection', error => {
  console.error(error);
  process.exit(1);
});

async function startCrawler({ query }, callback) {
  const url = query.url;

  if (!isUrlValid(url)) {
    return callback({
      error: new Error('Please provide a url with a protocol and host')
    });
  }

  try {
    const results = await crawl(url);
    return callback(null, results);
  } catch (error) {
    return callback({ error });
  }
}

module.exports = startCrawler;
